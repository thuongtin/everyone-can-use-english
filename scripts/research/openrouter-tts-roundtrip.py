"""ASR content check of freshly generated TTS files, not a human listening score."""
import concurrent.futures
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("openrouter-asr-acceptance.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
base = Path(sys.argv[1])
rows = json.loads((base / "tts-live/english-summary.json").read_text())
jobs = []
for row in rows:
    audio = Path(row["audioPath"]) if row.get("audioPath") else None
    if row["model"] == "google/gemini-3.1-flash-tts-preview":
        audio = base / "tts-live/google__gemini-3.1-flash-tts-preview/en-pcm-transcoded.mp3"
    if audio and audio.exists():
        jobs.append((row["model"], "en", audio, "microsoft/mai-transcribe-2"))
for audio in (base / "tts-live").glob("*/vi.mp3"):
    for recognizer in ["microsoft/mai-transcribe-2", "x-ai/grok-stt-1.0"]:
        jobs.append((audio.parent.name, "vi", audio, recognizer))


def run(job):
    model, language, audio, recognizer = job
    slug = (model + "-" + language + "-" + recognizer).replace("/", "__").replace(":", "_")
    dest = base / ("roundtrip-" + slug + ".json")
    if dest.exists():
        return json.loads(dest.read_text())
    wav = base / ("roundtrip-" + slug + ".wav")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(audio), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(wav)], check=True)
    reference = "The train leaves at seven thirty. Please bring your blue notebook." if language == "en" else "Hôm nay tôi học tiếng Anh trong mười phút."
    result = probe.request(base, recognizer, wav, language=language)
    result.update(ttsModel=model, language=language, reference=reference, audioPath=str(audio.resolve()))
    if result["status"] == 200:
        result["wer"] = probe.wer(reference, result["response"].get("text", ""))
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({"tts": model, "asr": recognizer, "language": language, "status": result["status"], "wer": result.get("wer"), "text": result.get("response", {}).get("text")}, ensure_ascii=False), flush=True)
    return result


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(run, jobs))
(base / "tts-roundtrip-matrix.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
