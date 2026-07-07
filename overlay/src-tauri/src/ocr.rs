//! Native OS OCR backends: Apple Vision on macOS, Windows.Media.Ocr on
//! Windows. No external install — replaces the former tesseract subprocess
//! pipeline.

use sysinfo::System;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameLocale {
    ZhTw,
    ZhCn,
    Ja,
    Ko,
    En,
}

/// Read the League client's `-Locale=` launch argument to pick OCR languages.
pub fn detect_game_locale() -> Option<GameLocale> {
    let sys = System::new_all();
    let locale = sys
        .processes()
        .values()
        .filter(|process| {
            let name = process
                .name()
                .to_string_lossy()
                .to_lowercase()
                .replace(' ', "");
            name.contains("leagueoflegends") || name.contains("leagueclient")
        })
        .flat_map(|process| process.cmd())
        .map(|arg| arg.to_string_lossy())
        .find_map(|arg| {
            arg.strip_prefix("-Locale=")
                .or_else(|| arg.strip_prefix("--locale="))
                .map(str::to_string)
        })?;

    match locale.as_str() {
        locale if locale.starts_with("zh_TW") => Some(GameLocale::ZhTw),
        locale if locale.starts_with("zh_CN") => Some(GameLocale::ZhCn),
        locale if locale.starts_with("ja_") => Some(GameLocale::Ja),
        locale if locale.starts_with("ko_") => Some(GameLocale::Ko),
        locale if locale.starts_with("en_") => Some(GameLocale::En),
        _ => None,
    }
}

/// True when the OS OCR engine can run at all. On macOS Vision ships with the
/// OS; on Windows this requires at least one OCR-capable language pack.
pub fn is_available() -> bool {
    backend::is_available()
}

/// OCR one card-name crop: 2x Lanczos upscale (parity with the old pipeline;
/// helps small glyphs) then native recognition. Whitespace is stripped to
/// match what the frontend matcher was tuned against. Returns `Ok(None)` when
/// no text was found.
pub fn read_card_text(
    crop: &image::DynamicImage,
    locale: Option<GameLocale>,
    known_names: &[String],
) -> Result<Option<String>, String> {
    let scaled = image::imageops::resize(
        crop,
        crop.width() * 2,
        crop.height() * 2,
        image::imageops::FilterType::Lanczos3,
    );
    let text = backend::recognize(
        &image::DynamicImage::ImageRgba8(scaled),
        locale,
        known_names,
    )?;
    let text: String = text.chars().filter(|c| !c.is_whitespace()).collect();
    Ok((!text.is_empty()).then_some(text))
}

#[cfg(target_os = "macos")]
#[allow(deprecated)]
mod backend {
    use super::GameLocale;
    use cocoa::base::{id, nil, BOOL, NO, YES};
    use cocoa::foundation::{NSArray, NSData, NSInteger, NSString, NSUInteger};
    use objc::rc::autoreleasepool;
    use objc::runtime::Class;
    use std::ffi::CStr;

    // Vision must be linked for its classes to be registered with the runtime.
    #[link(name = "Vision", kind = "framework")]
    extern "C" {}

    pub fn is_available() -> bool {
        Class::get("VNRecognizeTextRequest").is_some()
    }

    fn recognition_languages(locale: Option<GameLocale>) -> Vec<&'static str> {
        match locale {
            Some(GameLocale::ZhTw) => vec!["zh-Hant", "en-US"],
            Some(GameLocale::ZhCn) => vec!["zh-Hans", "en-US"],
            Some(GameLocale::Ja) => vec!["ja-JP", "en-US"],
            Some(GameLocale::Ko) => vec!["ko-KR", "en-US"],
            Some(GameLocale::En) => vec!["en-US"],
            None => vec!["en-US", "zh-Hant", "zh-Hans", "ja-JP", "ko-KR"],
        }
    }

    /// Build an autorelease-safe NSArray of NSStrings: the array retains each
    /// element, so we drop our own +1 from init_str immediately after.
    unsafe fn nsstring_array(values: &[&str]) -> id {
        let strings: Vec<id> = values
            .iter()
            .map(|value| NSString::alloc(nil).init_str(value))
            .collect();
        let array = NSArray::arrayWithObjects(nil, &strings);
        for string in strings {
            let _: () = msg_send![string, release];
        }
        array
    }

    unsafe fn nsstring_to_string(string: id) -> String {
        if string == nil {
            return String::new();
        }
        let ptr = NSString::UTF8String(string);
        if ptr.is_null() {
            return String::new();
        }
        CStr::from_ptr(ptr).to_string_lossy().into_owned()
    }

    unsafe fn nserror_description(error: id) -> String {
        if error == nil {
            return "unknown Vision error".to_string();
        }
        let description: id = msg_send![error, localizedDescription];
        let text = nsstring_to_string(description);
        if text.is_empty() {
            "unknown Vision error".to_string()
        } else {
            text
        }
    }

    pub fn recognize(
        image: &image::DynamicImage,
        locale: Option<GameLocale>,
        known_names: &[String],
    ) -> Result<String, String> {
        let mut png = std::io::Cursor::new(Vec::new());
        image
            .write_to(&mut png, image::ImageFormat::Png)
            .map_err(|e| format!("OCR failed: PNG encode: {}", e))?;
        let png = png.into_inner();

        autoreleasepool(|| unsafe {
            if !is_available() {
                return Err(
                    "OCR unavailable: Vision text recognition requires macOS 10.15+".to_string(),
                );
            }

            let data = NSData::dataWithBytes_length_(
                nil,
                png.as_ptr() as *const std::os::raw::c_void,
                png.len() as u64,
            );

            let request: id = msg_send![class!(VNRecognizeTextRequest), new];
            if request == nil {
                return Err("OCR unavailable: Vision request init failed".to_string());
            }
            // 0 = VNRequestTextRecognitionLevelAccurate
            let _: () = msg_send![request, setRecognitionLevel: 0 as NSInteger];
            let _: () = msg_send![request, setUsesLanguageCorrection: YES];

            let languages = nsstring_array(&recognition_languages(locale));
            let _: () = msg_send![request, setRecognitionLanguages: languages];

            if !known_names.is_empty() {
                let words: Vec<&str> = known_names.iter().map(String::as_str).collect();
                let words = nsstring_array(&words);
                let _: () = msg_send![request, setCustomWords: words];
            }

            let options: id = msg_send![class!(NSDictionary), dictionary];
            let handler: id = msg_send![class!(VNImageRequestHandler), alloc];
            let handler: id = msg_send![handler, initWithData: data options: options];
            if handler == nil {
                let _: () = msg_send![request, release];
                return Err("OCR failed: Vision could not read image data".to_string());
            }

            let requests = NSArray::arrayWithObject(nil, request);
            let mut error: id = nil;
            let ok: BOOL = msg_send![handler, performRequests: requests error: &mut error];

            let result = if ok == NO {
                Err(format!("OCR failed: {}", nserror_description(error)))
            } else {
                let results: id = msg_send![request, results];
                let count: NSUInteger = if results == nil {
                    0
                } else {
                    msg_send![results, count]
                };
                let mut out = String::new();
                for index in 0..count {
                    let observation: id = msg_send![results, objectAtIndex: index];
                    let candidates: id = msg_send![observation, topCandidates: 1 as NSUInteger];
                    let candidate_count: NSUInteger = if candidates == nil {
                        0
                    } else {
                        msg_send![candidates, count]
                    };
                    if candidate_count == 0 {
                        continue;
                    }
                    let candidate: id = msg_send![candidates, objectAtIndex: 0 as NSUInteger];
                    let string: id = msg_send![candidate, string];
                    out.push_str(&nsstring_to_string(string));
                }
                Ok(out)
            };

            let _: () = msg_send![handler, release];
            let _: () = msg_send![request, release];
            result
        })
    }
}

#[cfg(target_os = "windows")]
mod backend {
    use super::GameLocale;
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    pub fn is_available() -> bool {
        OcrEngine::AvailableRecognizerLanguages()
            .map(|languages| languages.Size().unwrap_or(0) > 0)
            .unwrap_or(false)
    }

    fn locale_tag_matches(locale: GameLocale, tag: &str) -> bool {
        let tag = tag.to_lowercase();
        match locale {
            GameLocale::ZhTw => tag.contains("hant") || tag.starts_with("zh-tw"),
            GameLocale::ZhCn => tag.contains("hans") || tag.starts_with("zh-cn"),
            GameLocale::Ja => tag.starts_with("ja"),
            GameLocale::Ko => tag.starts_with("ko"),
            GameLocale::En => tag.starts_with("en"),
        }
    }

    /// Prefer an installed OCR language matching the game locale; otherwise
    /// fall back to the user's profile languages.
    fn create_engine(locale: Option<GameLocale>) -> Result<OcrEngine, String> {
        if let Some(locale) = locale {
            if let Ok(languages) = OcrEngine::AvailableRecognizerLanguages() {
                for language in languages {
                    let tag = language
                        .LanguageTag()
                        .map(|tag| tag.to_string())
                        .unwrap_or_default();
                    if locale_tag_matches(locale, &tag) {
                        if let Ok(engine) = OcrEngine::TryCreateFromLanguage(&language) {
                            return Ok(engine);
                        }
                    }
                }
            }
        }
        OcrEngine::TryCreateFromUserProfileLanguages().map_err(|_| {
            "OCR unavailable: no Windows OCR language pack installed \
             (Settings > Time & Language > Language & Region)"
                .to_string()
        })
    }

    pub fn recognize(
        image: &image::DynamicImage,
        locale: Option<GameLocale>,
        // Windows.Media.Ocr has no custom-words hook; fuzzy matching happens
        // downstream in the frontend.
        _known_names: &[String],
    ) -> Result<String, String> {
        let rgba = image.to_rgba8();
        let (width, height) = rgba.dimensions();
        let mut bgra = rgba.into_raw();
        for pixel in bgra.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        let writer = DataWriter::new().map_err(|e| format!("OCR failed: {}", e))?;
        writer
            .WriteBytes(&bgra)
            .map_err(|e| format!("OCR failed: {}", e))?;
        let buffer = writer
            .DetachBuffer()
            .map_err(|e| format!("OCR failed: {}", e))?;

        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
        )
        .map_err(|e| format!("OCR failed: {}", e))?;

        let engine = create_engine(locale)?;
        let result = engine
            .RecognizeAsync(&bitmap)
            .and_then(|operation| operation.get())
            .map_err(|e| format!("OCR failed: {}", e))?;

        result
            .Text()
            .map(|text| text.to_string())
            .map_err(|e| format!("OCR failed: {}", e))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod backend {
    use super::GameLocale;

    pub fn is_available() -> bool {
        false
    }

    pub fn recognize(
        _image: &image::DynamicImage,
        _locale: Option<GameLocale>,
        _known_names: &[String],
    ) -> Result<String, String> {
        Err("OCR unavailable: unsupported platform".to_string())
    }
}
