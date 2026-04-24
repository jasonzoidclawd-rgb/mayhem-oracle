"""
Mayhem Oracle — Video Knowledge Pipeline
=========================================
Extracts game mechanics knowledge from YouTube video transcripts.
No API keys required. Uses youtube-transcript-api (free, no auth).

Usage:
    python scripts/learn_from_video.py https://www.youtube.com/watch?v=XXXXX
    python scripts/learn_from_video.py https://www.youtube.com/shorts/wnkM8h36xjk
    python scripts/learn_from_video.py --batch urls.txt

Output:
    Structured JSON in public/data/video_knowledge/ with extracted:
    - Champion × Augment interactions
    - Combo discoveries
    - Mechanic explanations
    - Win condition insights

Dependencies:
    pip install youtube-transcript-api
"""

import sys
import os
import json
import re
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api.formatters import TextFormatter
except ImportError:
    print("Install dependency: pip install youtube-transcript-api")
    sys.exit(1)


# ─── Known Entity Dictionaries ───
# These are used for entity extraction from transcripts.
# Expand as the augment database grows.

CHAMPION_ALIASES = {
    # English name → canonical ID (add more as needed)
    "brand": "brand", "vayne": "vayne", "graves": "graves",
    "morgana": "morgana", "yasuo": "yasuo", "jinx": "jinx",
    "urgot": "urgot", "sett": "sett", "ryze": "ryze",
    "lillia": "lillia", "fizz": "fizz", "zed": "zed",
    "mundo": "drmundo", "dr mundo": "drmundo", "dr. mundo": "drmundo",
    "aurelion sol": "aurelionsol", "a sol": "aurelionsol",
    "master yi": "masteryi", "yi": "masteryi",
    "miss fortune": "missfortune", "mf": "missfortune",
    "twisted fate": "twistedfate", "tf": "twistedfate",
    "caitlyn": "caitlyn", "karthus": "karthus",
    "malzahar": "malzahar", "malz": "malzahar",
    "hecarim": "hecarim", "heca": "hecarim",
    "leona": "leona", "blitzcrank": "blitzcrank", "blitz": "blitzcrank",
    "singed": "singed", "cassiopeia": "cassiopeia", "cass": "cassiopeia",
    "udyr": "udyr", "kayle": "kayle", "ezreal": "ezreal",
    "jhin": "jhin", "sona": "sona", "ziggs": "ziggs",
    # Chinese names (繁體)
    "乌尔加特": "urgot", "乌迪尔": "udyr", "瑟提": "sett",
    "乐芙兰": "leblanc", "乐蒂": "lillia", "布兰德": "brand",
    # Add more from ZH_REV dictionary as needed
}

AUGMENT_ALIASES = {
    # Known augment names → canonical ID
    "tap dancer": "tap_dancer", "踏舞者": "tap_dancer",
    "jeweled gauntlet": "jeweled_gauntlet", "珠光护手": "jeweled_gauntlet",
    "marksmage": "marksmage", "奥术射手": "marksmage", "奧術射手": "marksmage",
    "vulnerability": "vulnerability", "致命弱点": "vulnerability",
    "master of duality": "master_of_duality", "二元大师": "master_of_duality",
    "slow and steady": "slow_and_steady", "慢而稳健": "slow_and_steady",
    "mystic punch": "mystic_punch",
    "earthwake": "earthwake", "地动山摇": "earthwake",
    "draw your sword": "draw_your_sword", "拔剑": "draw_your_sword",
    "phenomenal evil": "phenomenal_evil", "超凡邪恶": "phenomenal_evil",
    "bread and butter": "bread_and_butter", "bread and cheese": "bread_and_cheese",
    "bread and jam": "bread_and_jam",
    "runecarver": "runecarver", "刻符者": "runecarver",
    "goliath": "goliath",
    "back to basics": "back_to_basics",
    "blunt force": "blunt_force",
    "snowball fight": "snowball_fight",
    "poro blaster": "poro_blaster",
    "infernal conduit": "infernal_conduit",
    "lightning strikes": "lightning_strikes",
    "magic missile": "magic_missile", "魔法导弹": "magic_missile",
    "witchful thinking": "witchful_thinking",
    "conqueror": "conqueror_augment",  # augment version
    "dark harvest": "dark_harvest_augment",  # augment version
    "press the attack": "press_the_attack_augment",
}

# Interaction signal phrases — indicate a champion × augment synergy
INTERACTION_SIGNALS = [
    r"(?:broken|insane|busted|op|overpowered|crazy|disgusting|cracked)\s+(?:on|with|combo)",
    r"(?:synergy|synergize|interaction|works?\s+with|pairs?\s+with|combo|combined?)",
    r"(?:infinite|unlimited|permanent|stacking|scales?|loop|exploit)",
    r"(?:best augment|must[\s-]pick|always take|never skip|first pick)",
    r"(?:win rate|winrate|wr)\s*(?:goes? up|increase|spike|jump)",
    r"(?:damage|dps|burst|one[\s-]shot|nuke|melt)",
    r"(?:trap|bait|noob[\s-]trap|don'?t take|avoid|worst|bad)",
]

# Mechanic signal phrases — indicate a rules explanation
MECHANIC_SIGNALS = [
    r"(?:how|why)\s+(?:it|this|the)\s+works?",
    r"(?:mechanic|interaction|bug|hidden|secret|tech|technique)",
    r"(?:reroll|re[\s-]roll|selection|choose|pick|draft)",
    r"(?:tier|silver|gold|prismatic|rarity)",
    r"(?:set bonus|augment set|collect|stack)",
    r"(?:on[\s-]hit|attack speed|crit|critical|cooldown|haste)",
]


# ─── YouTube Helpers ───

def extract_video_id(url: str) -> Optional[str]:
    """Extract video ID from various YouTube URL formats."""
    patterns = [
        r"(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})",
        r"(?:shorts\/)([a-zA-Z0-9_-]{11})",
        r"(?:embed\/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def fetch_transcript(video_id: str) -> Optional[str]:
    """
    Fetch transcript with language priority:
    1. English (en)
    2. Traditional Chinese (zh-TW, zh-Hant)
    3. Simplified Chinese (zh-CN, zh-Hans)
    4. Auto-generated in any language
    """
    preferred_langs = ["en", "zh-TW", "zh-Hant", "zh-CN", "zh-Hans", "ja", "ko"]

    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

        # Try manually created transcripts first
        for lang in preferred_langs:
            try:
                transcript = transcript_list.find_manually_created_transcript([lang])
                entries = transcript.fetch()
                return _format_transcript(entries)
            except Exception:
                continue

        # Fall back to auto-generated
        for lang in preferred_langs:
            try:
                transcript = transcript_list.find_generated_transcript([lang])
                entries = transcript.fetch()
                return _format_transcript(entries)
            except Exception:
                continue

        # Last resort: any available transcript
        for transcript in transcript_list:
            entries = transcript.fetch()
            return _format_transcript(entries)

    except Exception as e:
        print(f"  ⚠️  Could not fetch transcript: {e}")
        return None


def _format_transcript(entries) -> str:
    """Convert transcript entries to plain text."""
    return " ".join(
        entry.get("text", "") if isinstance(entry, dict) else str(entry)
        for entry in entries
    ).strip()


# ─── Knowledge Extraction ───

def extract_entities(text: str) -> dict:
    """Extract champion and augment mentions from transcript text."""
    text_lower = text.lower()

    champions_found = set()
    augments_found = set()

    for alias, canonical in CHAMPION_ALIASES.items():
        if alias in text_lower:
            champions_found.add(canonical)

    for alias, canonical in AUGMENT_ALIASES.items():
        if alias in text_lower:
            augments_found.add(canonical)

    return {
        "champions": sorted(champions_found),
        "augments": sorted(augments_found),
    }


def extract_interactions(text: str, entities: dict) -> list:
    """
    Find sentences where a champion and augment co-occur,
    with an interaction signal word nearby.
    """
    interactions = []
    sentences = re.split(r'[.!?\n]+', text)

    for sentence in sentences:
        s_lower = sentence.lower().strip()
        if len(s_lower) < 10:
            continue

        # Find which champions and augments appear in this sentence
        champs_in = [c for c in entities["champions"]
                     if any(a in s_lower for a, cid in CHAMPION_ALIASES.items() if cid == c)]
        augs_in = [a for a in entities["augments"]
                   if any(al in s_lower for al, aid in AUGMENT_ALIASES.items() if aid == a)]

        if not champs_in or not augs_in:
            continue

        # Check for interaction signal
        has_signal = any(re.search(p, s_lower) for p in INTERACTION_SIGNALS)
        is_trap = bool(re.search(r"trap|bait|avoid|don'?t|worst|bad", s_lower))

        if has_signal or (len(champs_in) >= 1 and len(augs_in) >= 1):
            interactions.append({
                "champions": champs_in,
                "augments": augs_in,
                "sentence": sentence.strip()[:200],
                "sentiment": "trap" if is_trap else "synergy",
                "confidence": "high" if has_signal else "medium",
            })

    return interactions


def extract_mechanic_insights(text: str) -> list:
    """Find sentences that explain game mechanics."""
    insights = []
    sentences = re.split(r'[.!?\n]+', text)

    for sentence in sentences:
        s_lower = sentence.lower().strip()
        if len(s_lower) < 20:
            continue

        has_mechanic_signal = any(re.search(p, s_lower) for p in MECHANIC_SIGNALS)
        if has_mechanic_signal:
            insights.append({
                "text": sentence.strip()[:300],
                "topics": _classify_topics(s_lower),
            })

    return insights[:20]  # Cap at 20 to avoid noise


def _classify_topics(text: str) -> list:
    """Classify a mechanic insight into topic categories."""
    topics = []
    topic_patterns = {
        "reroll_mechanics": r"reroll|re[\s-]roll|selection",
        "tier_system": r"tier|silver|gold|prismatic|rarity",
        "augment_sets": r"set bonus|augment set|collect.*set",
        "on_hit": r"on[\s-]hit|attack.*effect",
        "crit_mechanics": r"crit|critical|strike",
        "cooldown": r"cooldown|haste|cd|cdr",
        "movement": r"move.*speed|dash|mobility",
        "stacking": r"stack|infinite|scaling|growth",
        "combat_math": r"damage|dps|armor|penetration|resist",
    }
    for topic, pattern in topic_patterns.items():
        if re.search(pattern, text):
            topics.append(topic)
    return topics


# ─── Main Pipeline ───

def process_video(url: str, output_dir: str = "public/data/video_knowledge") -> dict:
    """Full pipeline: URL → transcript → structured knowledge."""

    video_id = extract_video_id(url)
    if not video_id:
        print(f"  ❌ Could not extract video ID from: {url}")
        return {}

    print(f"  📹 Processing video: {video_id}")

    # Check if already processed
    output_path = Path(output_dir) / f"{video_id}.json"
    if output_path.exists():
        print(f"  ⏭️  Already processed: {output_path}")
        with open(output_path) as f:
            return json.load(f)

    # Fetch transcript
    transcript = fetch_transcript(video_id)
    if not transcript:
        return {}

    print(f"  📝 Transcript length: {len(transcript)} chars")

    # Extract knowledge
    entities = extract_entities(transcript)
    print(f"  🎯 Found: {len(entities['champions'])} champions, {len(entities['augments'])} augments")

    interactions = extract_interactions(transcript, entities)
    print(f"  🔗 Found: {len(interactions)} champion×augment interactions")

    mechanic_insights = extract_mechanic_insights(transcript)
    print(f"  🔧 Found: {len(mechanic_insights)} mechanic insights")

    # Build output
    result = {
        "video_id": video_id,
        "url": url,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "transcript_hash": hashlib.md5(transcript.encode()).hexdigest(),
        "transcript_length": len(transcript),
        "entities": entities,
        "interactions": interactions,
        "mechanic_insights": mechanic_insights,
        "raw_transcript": transcript[:5000],  # Keep first 5k chars for reference
    }

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"  ✅ Saved to: {output_path}")
    return result


def aggregate_knowledge(knowledge_dir: str = "public/data/video_knowledge") -> dict:
    """
    Aggregate all video knowledge into a unified interaction database.
    This feeds into the Oracle Score algorithm as a supplementary signal.
    """
    knowledge_path = Path(knowledge_dir)
    if not knowledge_path.exists():
        return {}

    all_interactions = []
    all_insights = []
    video_count = 0

    for json_file in knowledge_path.glob("*.json"):
        if json_file.name == "_aggregated.json":
            continue
        with open(json_file) as f:
            data = json.load(f)
        all_interactions.extend(data.get("interactions", []))
        all_insights.extend(data.get("mechanic_insights", []))
        video_count += 1

    # Count interaction frequency (champion × augment pairs)
    pair_counts: dict[str, int] = {}
    pair_sentiments: dict[str, list] = {}

    for interaction in all_interactions:
        for champ in interaction["champions"]:
            for aug in interaction["augments"]:
                key = f"{champ}:{aug}"
                pair_counts[key] = pair_counts.get(key, 0) + 1
                pair_sentiments.setdefault(key, []).append(interaction["sentiment"])

    # Rank by frequency
    ranked_pairs = sorted(pair_counts.items(), key=lambda x: -x[1])

    aggregated = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "videos_processed": video_count,
        "total_interactions": len(all_interactions),
        "total_insights": len(all_insights),
        "top_synergies": [
            {
                "champion": k.split(":")[0],
                "augment": k.split(":")[1],
                "mentions": v,
                "sentiment_ratio": {
                    "synergy": pair_sentiments[k].count("synergy"),
                    "trap": pair_sentiments[k].count("trap"),
                },
            }
            for k, v in ranked_pairs[:50]
        ],
        "mechanic_topics": _count_topics(all_insights),
    }

    output_path = knowledge_path / "_aggregated.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(aggregated, f, ensure_ascii=False, indent=2)

    print(f"\n📊 Aggregated {video_count} videos → {len(ranked_pairs)} unique interactions")
    return aggregated


def _count_topics(insights: list) -> dict:
    """Count topic frequency across all mechanic insights."""
    counts: dict[str, int] = {}
    for insight in insights:
        for topic in insight.get("topics", []):
            counts[topic] = counts.get(topic, 0) + 1
    return dict(sorted(counts.items(), key=lambda x: -x[1]))


# ─── CLI ───

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python scripts/learn_from_video.py <youtube_url>")
        print("  python scripts/learn_from_video.py --batch <urls_file>")
        print("  python scripts/learn_from_video.py --aggregate")
        sys.exit(1)

    if sys.argv[1] == "--aggregate":
        aggregate_knowledge()
    elif sys.argv[1] == "--batch":
        with open(sys.argv[2]) as f:
            urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        for url in urls:
            process_video(url)
        aggregate_knowledge()
    else:
        process_video(sys.argv[1])
        if "--aggregate" in sys.argv:
            aggregate_knowledge()
