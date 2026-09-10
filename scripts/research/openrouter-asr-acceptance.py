"""Small paid ASR probes. Reads a private key file; never logs request payloads."""
import argparse
import base64
import concurrent.futures
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


def request(base, model, audio, language="en", verbose=True, options=None):
    payload = {"model": model, "input_audio": {"data": base64.b64encode(audio.read_bytes()).decode(), "format": "wav"}, "language": language, "response_format": "verbose_json" if verbose else "json"}
    if verbose:
        payload["timestamp_granularities"] = ["segment", "word"]
    if options:
        payload["provider"] = {"options": options}
    key = (base / ".openrouter-key").read_text().strip()
    req = urllib.request.Request("https://openrouter.ai/api/v1/audio/transcriptions", data=json.dumps(payload).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json", "User-Agent": "EnjoyProviderAcceptance/1.0"})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            status, generation, raw = response.status, response.headers.get("X-Generation-Id"), response.read()
    except urllib.error.HTTPError as error:
        status, generation, raw = error.code, error.headers.get("X-Generation-Id"), error.read()
    except Exception as error:
        return {"model": model, "status": "transport_error", "elapsedSeconds": round(time.monotonic()-start, 3), "errorType": type(error).__name__}
    try:
        body = json.loads(raw)
    except ValueError:
        body = {"rawText": raw.decode(errors="replace")[:2000]}
    return {"model": model, "fixture": audio.name, "responseFormat": payload["response_format"], "status": status, "elapsedSeconds": round(time.monotonic()-start, 3), "generationId": generation, "response": body}


def words(text):
    return re.findall(r"\w+", text.lower())


def wer(reference, hypothesis):
    a, b = words(reference), words(hypothesis)
    row = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        nxt = [i]
        for j, y in enumerate(b, 1):
            nxt.append(min(row[j]+1, nxt[-1]+1, row[j-1]+(x != y)))
        row = nxt
    return row[-1]/len(a) if a else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    args = parser.parse_args()
    base = args.base
    reference = (base / "jfk-reference.txt").read_text()
    models = json.loads((base / "transcription-models.json").read_text())["data"]
    def run(model):
        mid = model["id"]
        dest = base / ("asr-" + mid.replace("/", "__").replace(":", "_") + ".json")
        if dest.exists():
            return json.loads(dest.read_text())
        if mid == "microsoft/mai-transcribe-2":
            result = json.loads((base / "mai-first.json").read_text())
            result.update(model=mid, fixture="jfk.wav", responseFormat="verbose_json")
        else:
            result = request(base, mid, base / "jfk.wav")
        attempts = [result]
        if result["status"] in [400, 422] or result.get("errorType") == "TimeoutError":
            attempts.append(request(base, mid, base / "jfk.wav", verbose=False))
        final = attempts[-1]
        body = final.get("response", {})
        success = final["status"] == 200 and isinstance(body.get("text"), str) and bool(body["text"].strip())
        output = {"model": mid, "pass": success, "wer": wer(reference, body["text"]) if success else None, "wordCount": len(body.get("words") or []), "segmentCount": len(body.get("segments") or []), "attempts": attempts}
        dest.write_text(json.dumps(output, ensure_ascii=False, indent=2))
        print(json.dumps({k:v for k,v in output.items() if k != "attempts"}), flush=True)
        return output
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(run, models))
    (base / "asr-matrix.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
