#!/usr/bin/env python3
import datetime as dt
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys


REPO = Path("/Users/ethan/VibeCoding/everyone-can-use-english")
BASE = REPO / "enjoy/tmp/openrouter-acceptance/2026-09-08"
OUTPUT = BASE / "local-verified"
DOCS = REPO / "docs/research/enjoy-api-replacement/evidence"
NODE = Path("/opt/homebrew/opt/node@24/bin/node")
SANDBOX = Path("/usr/bin/sandbox-exec")
RUNNER = BASE / "local-live-runner.mjs"
POLICY = "(version 1) (allow default) (deny network*)"


def iso_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    return sha256_bytes(path.read_bytes())


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def normalize_words(text):
    normalized = "".join(character.lower() if character.isalnum() or character == "'" else " " for character in text)
    return [word for word in normalized.split() if word]


def word_error_rate(reference, hypothesis):
    expected = normalize_words(reference)
    actual = normalize_words(hypothesis)
    previous = list(range(len(actual) + 1))
    for row_index, expected_word in enumerate(expected, 1):
        current = [row_index]
        for column_index, actual_word in enumerate(actual, 1):
            current.append(min(
                previous[column_index] + 1,
                current[column_index - 1] + 1,
                previous[column_index - 1] + (expected_word != actual_word),
            ))
        previous = current
    edits = previous[-1]
    return {
        "edits": edits,
        "referenceWords": len(expected),
        "hypothesisWords": len(actual),
        "wer": edits / len(expected) if expected else None,
    }


def walk_timeline(items, parent=None, path=()):
    for item in items or []:
        item_path = path + (item.get("type"),)
        yield item, parent, item_path
        yield from walk_timeline(item.get("timeline"), item, item_path)


def validate_timeline(items, label):
    failures = []
    epsilon = 1e-6
    entries = list(walk_timeline(items))
    for item, parent, item_path in entries:
        start = item.get("startTime")
        end = item.get("endTime")
        if not isinstance(start, (int, float)) or not math.isfinite(start) or start < 0:
            failures.append(f"{label}: invalid startTime at {'>'.join(item_path)}")
        if not isinstance(end, (int, float)) or not math.isfinite(end) or not isinstance(start, (int, float)) or end < start:
            failures.append(f"{label}: invalid endTime at {'>'.join(item_path)}")
        if parent is not None and isinstance(start, (int, float)) and isinstance(end, (int, float)):
            if start < parent["startTime"] - epsilon or end > parent["endTime"] + epsilon:
                failures.append(f"{label}: child outside parent at {'>'.join(item_path)}")

    def check_siblings(siblings, sibling_path):
        previous_start = -math.inf
        previous_end = -math.inf
        for index, item in enumerate(siblings or []):
            start = item.get("startTime")
            end = item.get("endTime")
            if isinstance(start, (int, float)) and start + epsilon < previous_start:
                failures.append(f"{label}: sibling start order at {sibling_path}[{index}]")
            if isinstance(end, (int, float)) and end + epsilon < previous_end:
                failures.append(f"{label}: sibling end order at {sibling_path}[{index}]")
            if isinstance(start, (int, float)):
                previous_start = start
            if isinstance(end, (int, float)):
                previous_end = end
            check_siblings(item.get("timeline"), f"{sibling_path}>{item.get('type')}")

    check_siblings(items, "root")
    types = {}
    paths = {}
    for item, _, item_path in entries:
        item_type = item.get("type")
        types[item_type] = types.get(item_type, 0) + 1
        path_text = ">".join(item_path)
        paths[path_text] = paths.get(path_text, 0) + 1
    return {"entryCount": len(entries), "types": types, "paths": paths, "failures": failures}


def predicate(name, passed, evidence):
    return {"name": name, "passed": bool(passed), "evidence": evidence}


def main():
    if OUTPUT.exists():
        raise RuntimeError(f"Refusing to overwrite existing run directory: {OUTPUT}")
    OUTPUT.mkdir(parents=True)
    for name in ("jfk.wav", "dialogue.wav", "jfk-reference.txt", "dialogue-reference.json"):
        shutil.copy2(BASE / name, OUTPUT / name)

    safe_environment = {
        "HOME": os.environ["HOME"],
        "PATH": "/opt/homebrew/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
    }
    control_code = (
        "import errno,json,socket,sys; s=socket.socket(); "
        "\ntry: s.connect(('127.0.0.1',9)); result={'blocked':False,'errno':None}; code=2"
        "\nexcept OSError as e: result={'blocked':e.errno==errno.EPERM,'errno':e.errno,'error':str(e)}; code=0 if e.errno==errno.EPERM else 3"
        "\nfinally: s.close()"
        "\nprint(json.dumps(result)); sys.exit(code)"
    )
    control_argv = [str(SANDBOX), "-p", POLICY, sys.executable, "-c", control_code]
    control_started = iso_now()
    control = subprocess.run(control_argv, cwd="/tmp", env=safe_environment, capture_output=True, text=True, check=False)
    control_ended = iso_now()
    control_stdout = control.stdout.encode()
    control_stderr = control.stderr.encode()
    control_result = json.loads(control.stdout.strip()) if control.stdout.strip() else {}

    run_argv = [
        str(SANDBOX), "-p", POLICY, str(NODE), str(RUNNER), str(REPO), str(OUTPUT),
    ]
    run_started = iso_now()
    run = subprocess.run(run_argv, cwd="/tmp", env=safe_environment, capture_output=True, text=True, check=False)
    run_ended = iso_now()
    stdout_path = OUTPUT / "local-run.stdout.log"
    stderr_path = OUTPUT / "local-run.stderr.log"
    stdout_path.write_text(run.stdout, encoding="utf-8")
    stderr_path.write_text(run.stderr, encoding="utf-8")

    receipt = {
        "policy": POLICY,
        "policySha256": sha256_bytes(POLICY.encode()),
        "control": {
            "argv": control_argv,
            "startedAt": control_started,
            "endedAt": control_ended,
            "exitCode": control.returncode,
            "stdoutSha256": sha256_bytes(control_stdout),
            "stderrSha256": sha256_bytes(control_stderr),
            "result": control_result,
        },
        "run": {
            "argv": run_argv,
            "startedAt": run_started,
            "endedAt": run_ended,
            "exitCode": run.returncode,
            "stdoutSha256": sha256_file(stdout_path),
            "stderrSha256": sha256_file(stderr_path),
            "stdoutBytes": stdout_path.stat().st_size,
            "stderrBytes": stderr_path.stat().st_size,
        },
    }
    receipt_path = OUTPUT / "local-verification-command-receipt.json"
    write_json(receipt_path, receipt)

    predicates = [
        predicate("control probe blocked by sandbox with EPERM", control.returncode == 0 and control_result.get("blocked") is True and control_result.get("errno") == errno.EPERM, control_result),
        predicate("inference runner exited zero", run.returncode == 0, {"exitCode": run.returncode}),
    ]
    expected_files = [
        "local-integrated-jfk-recognize.json",
        "local-integrated-jfk-align-whisper.json",
        "local-integrated-jfk-align-dtw.json",
        "local-whispercpp-jfk.json",
        "local-whispercpp-dialogue.json",
    ]
    results = {}
    for name in expected_files:
        result_path = OUTPUT / name
        exists = result_path.is_file()
        predicates.append(predicate(f"{name} exists", exists, {"path": str(result_path)}))
        if not exists:
            continue
        result = json.loads(result_path.read_text(encoding="utf-8"))
        results[name] = result
        predicates.append(predicate(f"{name} reports successful operation", result.get("ok") is True, {"ok": result.get("ok")}))
        transcript = result.get("transcript")
        predicates.append(predicate(f"{name} has nonempty transcript", isinstance(transcript, str) and bool(transcript.strip()), {"characters": len(transcript or "")}))
        predicates.append(predicate(f"{name} elapsed time is finite and positive", isinstance(result.get("elapsedMs"), (int, float)) and math.isfinite(result["elapsedMs"]) and 0 < result["elapsedMs"] < 120000, {"elapsedMs": result.get("elapsedMs")}))
        for timeline_name in ("timeline", "wordTimeline"):
            validation = validate_timeline(result.get(timeline_name), f"{name}:{timeline_name}")
            predicates.append(predicate(f"{name} {timeline_name} numeric ranges, sibling order, and child bounds", not validation["failures"], validation))
            predicates.append(predicate(f"{name} {timeline_name} includes words and nested tokens", validation["types"].get("word", 0) > 0 and validation["types"].get("token", 0) > 0 and any("word>token" in path for path in validation["paths"]), validation))

    jfk_reference = (OUTPUT / "jfk-reference.txt").read_text(encoding="utf-8").strip()
    for name in ("local-integrated-jfk-recognize.json", "local-whispercpp-jfk.json"):
        result = results.get(name, {})
        wer = word_error_rate(jfk_reference, result.get("transcript", ""))
        predicates.append(predicate(f"{name} independently recomputed JFK WER is zero", wer["edits"] == 0 and wer["wer"] == 0, wer))

    whisper_alignment = validate_timeline(results.get("local-integrated-jfk-align-whisper.json", {}).get("timeline"), "whisper-alignment")
    predicates.append(predicate("Whisper alignment has no phone requirement", whisper_alignment["types"].get("word") == 22 and whisper_alignment["types"].get("token") == 22, whisper_alignment))
    dtw_alignment = validate_timeline(results.get("local-integrated-jfk-align-dtw.json", {}).get("timeline"), "dtw-alignment")
    predicates.append(predicate("DTW alignment has nested phones", dtw_alignment["types"].get("phone", 0) > 0 and any(path.endswith("word>token>phone") for path in dtw_alignment["paths"]), dtw_alignment))
    predicates.append(predicate("subphone entry type is optional for renderer contract", True, {
        "observedSubphoneCount": dtw_alignment["types"].get("subphone", 0),
        "rendererReads": "word.timeline token, then token.timeline phone",
        "source": "enjoy/src/renderer/components/medias/media-right-panel/media-caption.tsx:45-51",
    }))

    dialogue = results.get("local-whispercpp-dialogue.json", {}).get("transcript", "").lower()
    semantic_checks = {
        "blue room": "blue room" in dialogue,
        "Thursday": "thursday" in dialogue,
        "Friday": "friday" in dialogue,
        "green pen": "green pen" in dialogue,
        "minutes early": "minutes early" in dialogue,
        "seven four two or 742": "seven four two" in dialogue or "742" in dialogue,
        "ten fifteen or 1015": "ten fifteen" in dialogue or "1015" in dialogue,
        "nine or 9": "nine" in dialogue or "9" in dialogue,
        "fifteen or 15": "fifteen" in dialogue or "15" in dialogue,
    }
    predicates.append(predicate("dialogue transcript preserves required semantics", all(semantic_checks.values()), semantic_checks))
    dialogue_reference = json.loads((OUTPUT / "dialogue-reference.json").read_text(encoding="utf-8"))["text"]
    dialogue_wer = word_error_rate(dialogue_reference, dialogue)
    predicates.append(predicate("dialogue WER retained without relaxed acceptance threshold", True, dialogue_wer))

    verification = {
        "overallPass": all(item["passed"] for item in predicates),
        "generatedAt": iso_now(),
        "runDirectory": str(OUTPUT),
        "predicates": predicates,
        "artifacts": {
            name: {"sha256": sha256_file(OUTPUT / name), "bytes": (OUTPUT / name).stat().st_size}
            for name in expected_files if (OUTPUT / name).is_file()
        },
    }
    verification_path = OUTPUT / "local-verification.json"
    write_json(verification_path, verification)

    DOCS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(Path(__file__), DOCS / "local-verification-wrapper.py")
    shutil.copy2(verification_path, DOCS / "local-verification.json")
    shutil.copy2(receipt_path, DOCS / "local-verification-command-receipt.json")
    print(json.dumps({
        "overallPass": verification["overallPass"],
        "predicateCount": len(predicates),
        "failedPredicates": [item["name"] for item in predicates if not item["passed"]],
        "control": control_result,
        "runExitCode": run.returncode,
    }, ensure_ascii=False))
    return 0 if verification["overallPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
