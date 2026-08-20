//! OCR/Vision scan telemetry must preserve causal timing correlation per
//! worker/native operation. A/B/C classification is valid only when dispatch,
//! native, and resume phases come from the same operation; aggregate OCR wall
//! clock (`ocrMs`) remains separate from native elapsed time.

use mayhem_oracle_lib::{
    representative_ocr_timing, DetectedAugment, OcrCardDiagnostic, OcrOperationTiming,
    OcrScanResult,
};
use serde_json::Value;

fn empty_diagnostics() -> Vec<OcrCardDiagnostic> {
    (0..3)
        .map(|region_index| OcrCardDiagnostic {
            region_index,
            card_rect: None,
            crop: None,
            capture_succeeded: true,
            raw_text: None,
            error: None,
            capture_width: None,
            capture_height: None,
        })
        .collect()
}

fn timing(
    operation_id: usize,
    async_start_wait_ms: u64,
    dispatch_wait_ms: u64,
    native_elapsed_ms: u64,
    resume_wait_ms: u64,
) -> OcrOperationTiming {
    OcrOperationTiming {
        operation_id,
        worker_id: operation_id,
        region_index: operation_id,
        async_start_wait_ms,
        dispatch_wait_ms,
        native_elapsed_ms,
        resume_wait_ms,
    }
}

fn scan_with_timings(ocr_operation_timings: Vec<OcrOperationTiming>) -> OcrScanResult {
    let representative = representative_ocr_timing(&ocr_operation_timings);
    OcrScanResult {
        detected: vec![DetectedAugment {
            text: "placeholder".to_string(),
            region_index: 0,
        }],
        diagnostics: empty_diagnostics(),
        capture_attempted: true,
        crop_count: 3,
        capture_ms: 300,
        ocr_ms: 500,
        total_ms: 820,
        capture_dispatch_wait_ms: 20,
        capture_resume_wait_ms: 5,
        ocr_async_start_wait_ms: representative
            .map(|timing| timing.async_start_wait_ms)
            .unwrap_or(0),
        ocr_dispatch_wait_ms: representative
            .map(|timing| timing.dispatch_wait_ms)
            .unwrap_or(0),
        ocr_native_elapsed_ms: representative
            .map(|timing| timing.native_elapsed_ms)
            .unwrap_or(0),
        ocr_resume_wait_ms: representative
            .map(|timing| timing.resume_wait_ms)
            .unwrap_or(0),
        ocr_operation_timings,
    }
}

fn serialized(result: &OcrScanResult) -> Value {
    serde_json::to_value(result).expect("OcrScanResult must serialize")
}

fn key_list(value: &Value) -> Vec<String> {
    value
        .as_object()
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default()
}

fn number_field(value: &Value, key: &str) -> f64 {
    let field = value.get(key);
    assert!(
        field.is_some(),
        "OcrScanResult must serialize `{}` (serde rename_all = \"camelCase\"); keys present: {:?}",
        key,
        key_list(value)
    );
    field
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("`{}` must serialize as a JSON number, got {:?}", key, field))
}

fn operation_timings(value: &Value) -> Vec<Value> {
    value
        .get("ocrOperationTimings")
        .and_then(Value::as_array)
        .cloned()
        .expect("ocrOperationTimings must serialize as an array")
}

#[test]
fn two_workers_with_different_worst_phases_do_not_create_synthetic_summary() {
    let value = serialized(&scan_with_timings(vec![
        timing(0, 1, 200, 10, 1),
        timing(1, 1, 2, 10, 180),
    ]));

    assert_eq!(number_field(&value, "ocrDispatchWaitMs"), 200.0);
    assert_eq!(number_field(&value, "ocrResumeWaitMs"), 1.0);
    assert_ne!(
        number_field(&value, "ocrResumeWaitMs"),
        180.0,
        "summary must copy all phases from one representative operation, not combine independent maxima"
    );
}

#[test]
fn spawn_to_first_poll_delay_is_reported_separately() {
    let value = serialized(&scan_with_timings(vec![timing(0, 75, 3, 11, 5)]));

    assert_eq!(number_field(&value, "ocrAsyncStartWaitMs"), 75.0);
    let operation = &operation_timings(&value)[0];
    assert_eq!(number_field(operation, "asyncStartWaitMs"), 75.0);
}

#[test]
fn spawn_to_first_poll_delay_is_not_counted_as_native_elapsed() {
    let value = serialized(&scan_with_timings(vec![timing(0, 75, 3, 11, 5)]));

    assert_eq!(number_field(&value, "ocrNativeElapsedMs"), 11.0);
    assert_ne!(number_field(&value, "ocrNativeElapsedMs"), 86.0);
}

#[test]
fn native_elapsed_contains_only_native_start_to_native_end() {
    let value = serialized(&scan_with_timings(vec![timing(0, 7, 13, 29, 31)]));

    assert_eq!(number_field(&value, "ocrNativeElapsedMs"), 29.0);
}

#[test]
fn resume_wait_contains_only_native_end_to_async_continuation() {
    let value = serialized(&scan_with_timings(vec![timing(0, 7, 13, 29, 31)]));

    assert_eq!(number_field(&value, "ocrResumeWaitMs"), 31.0);
}

#[test]
fn one_correlated_record_identifies_the_same_operation_for_every_phase() {
    let value = serialized(&scan_with_timings(vec![timing(2, 7, 13, 29, 31)]));
    let operation = &operation_timings(&value)[0];

    assert_eq!(number_field(operation, "operationId"), 2.0);
    assert_eq!(number_field(operation, "workerId"), 2.0);
    assert_eq!(number_field(operation, "regionIndex"), 2.0);
    assert_eq!(number_field(operation, "asyncStartWaitMs"), 7.0);
    assert_eq!(number_field(operation, "dispatchWaitMs"), 13.0);
    assert_eq!(number_field(operation, "nativeElapsedMs"), 29.0);
    assert_eq!(number_field(operation, "resumeWaitMs"), 31.0);
}

#[test]
fn multiple_worker_output_remains_deterministically_attributable() {
    let value = serialized(&scan_with_timings(vec![
        timing(0, 1, 2, 3, 4),
        timing(2, 5, 6, 7, 8),
        timing(1, 9, 10, 11, 12),
    ]));
    let ids: Vec<f64> = operation_timings(&value)
        .iter()
        .map(|operation| number_field(operation, "operationId"))
        .collect();

    assert_eq!(ids, vec![0.0, 2.0, 1.0]);
    assert_eq!(number_field(&value, "ocrDispatchWaitMs"), 10.0);
    assert_eq!(number_field(&value, "ocrNativeElapsedMs"), 11.0);
    assert_eq!(number_field(&value, "ocrResumeWaitMs"), 12.0);
}

#[test]
fn timing_fields_keep_their_camel_case_javascript_contract() {
    let value = serialized(&scan_with_timings(vec![timing(0, 7, 13, 29, 31)]));

    for key in [
        "captureMs",
        "ocrMs",
        "totalMs",
        "captureDispatchWaitMs",
        "captureResumeWaitMs",
        "ocrAsyncStartWaitMs",
        "ocrDispatchWaitMs",
        "ocrNativeElapsedMs",
        "ocrResumeWaitMs",
    ] {
        let ms = number_field(&value, key);
        assert!(ms >= 0.0, "`{}` must never serialize negative", key);
    }

    for key in [
        "capture_ms",
        "ocr_ms",
        "total_ms",
        "capture_dispatch_wait_ms",
        "capture_resume_wait_ms",
        "ocr_async_start_wait_ms",
        "ocr_dispatch_wait_ms",
        "ocr_native_elapsed_ms",
        "ocr_resume_wait_ms",
        "ocr_operation_timings",
    ] {
        assert!(
            value.get(key).is_none(),
            "`{}` leaked as snake_case; keys present: {:?}",
            key,
            key_list(&value)
        );
    }
}

#[test]
fn a_timed_out_or_refused_scan_reports_zero_waits_not_a_fabricated_signal() {
    let value = serialized(&scan_with_timings(Vec::new()));

    for key in [
        "ocrAsyncStartWaitMs",
        "ocrDispatchWaitMs",
        "ocrNativeElapsedMs",
        "ocrResumeWaitMs",
    ] {
        assert_eq!(number_field(&value, key), 0.0);
    }
    assert!(operation_timings(&value).is_empty());
}
