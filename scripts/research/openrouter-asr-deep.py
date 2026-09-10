"""Follow-up ASR probes on public and synthetic fixtures."""
import concurrent.futures
import importlib.util
import json
import sys
from pathlib import Path

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("openrouter-asr-acceptance.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
base = Path(sys.argv[1])
models = ["microsoft/mai-transcribe-2", "deepgram/nova-3", "x-ai/grok-stt-1.0", "openai/whisper-large-v3-turbo", "qwen/qwen3-asr-0.6b", "openai/whisper-1"]
jobs = [(model, fixture) for model in models for fixture in ["dialogue", "vietnamese", "silence"]]


def run(job):
    model, fixture = job
    dest = base / ("deep-" + model.replace("/", "__") + "-" + fixture + ".json")
    if dest.exists():
        return json.loads(dest.read_text())
    options = None
    if fixture == "dialogue":
        if model == "microsoft/mai-transcribe-2":
            options = {"azure": {"diarization": {"enabled": True}}}
        if model == "deepgram/nova-3":
            options = {"deepgram": {"diarize": True}}
    result = probe.request(base, model, base / (fixture + ".wav"), language="vi" if fixture == "vietnamese" else "en", options=options)
    body = result.get("response", {})
    reference = json.loads((base / "dialogue-reference.json").read_text())["text"] if fixture == "dialogue" else (base / "vietnamese-reference.txt").read_text() if fixture == "vietnamese" else ""
    if result["status"] == 200:
        result["wer"] = probe.wer(reference, body.get("text", ""))
        result["emptyText"] = not body.get("text", "").strip()
        result["wordCount"] = len(body.get("words") or [])
        result["speakers"] = sorted(set(str(x["speaker"]) for x in (body.get("segments") or []) + (body.get("words") or []) if "speaker" in x))
        timed = body.get("words") or []
        result["invalidWordRanges"] = sum(not(isinstance(w.get("start"), (int,float)) and isinstance(w.get("end"), (int,float)) and 0 <= w["start"] <= w["end"]) for w in timed)
    dest.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps({k:v for k,v in result.items() if k != "response"}, ensure_ascii=False), flush=True)
    return result


with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    results = list(pool.map(run, jobs))
(base / "asr-deep-matrix.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
