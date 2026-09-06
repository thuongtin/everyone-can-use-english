"""Apply recorded content reviews only while their asset and context match."""
from collections import Counter

ACCEPTED_STATUSES = {'reviewed-keep-original', 'reviewed-translated'}
ACCEPTED_METHODS = {
    'asr-full-audio-and-context',
    'visual-full-image-and-context',
    'visual-full-video-and-replaced-audio',
    'font-language-coverage-inspection',
}

AUDIO_LANGUAGE_AUDIT_STATUS = 'reviewed-language-audit'
AUDIO_LANGUAGE_AUDIT_METHOD = 'asr-full-audio-language-audit'
AUDIO_LANGUAGE_KINDS = {'.mp3', '.wav', '.aiff'}
AUDIO_LANGUAGE_AUDIT_SCOPE = 'All tracked audio assets, including archive members, were decoded in full for language detection.'
SOURCE_TEXT_AUDIT_STATUS = 'reviewed-source-text-audit'
SOURCE_TEXT_AUDIT_METHOD = 'source-full-text-no-han'
SOURCE_TEXT_AUDIT_KINDS = {'.svg', '.ipynb'}
SOURCE_TEXT_AUDIT_SCOPE = 'All tracked SVG and notebook assets were read in full and contain no Han characters in source text.'


def apply_audio_language_audit(entries, audit):
    """Apply a full-audio language audit without claiming a translation review."""
    if audit.get('version') != 1 or audit.get('method') != 'echogarden-whisper-tiny-language-detection' or audit.get('scope') != AUDIO_LANGUAGE_AUDIT_SCOPE or not isinstance(audit.get('records'), list):
        return [{'issue': 'invalid-audio-language-audit'}]

    scoped_entries = [
        entry for entry in entries
        if entry['kind'] in AUDIO_LANGUAGE_KINDS
    ]
    by_path = {entry['path']: entry for entry in scoped_entries}
    records = audit['records']
    paths = Counter(record.get('path') for record in records if isinstance(record, dict) and isinstance(record.get('path'), str))
    if set(paths) != set(by_path) or any(count != 1 for count in paths.values()):
        return [{'issue': 'audio-language-audit-coverage-mismatch'}]

    issues = []
    for record in records:
        path = record.get('path')
        entry = by_path.get(path)
        reason = None
        confidence = record.get('detected_confidence')
        if not isinstance(path, str) or not entry:
            reason = 'audio-language-audit-unknown-path'
        elif record.get('sha256') != entry['sha256']:
            reason = 'stale-audio-language-audit'
        elif not isinstance(record.get('detected_language'), str) or not record['detected_language'].strip():
            reason = 'missing-detected-audio-language'
        elif not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1:
            reason = 'invalid-audio-language-confidence'
        elif not isinstance(record.get('resolved_language'), str) or not record['resolved_language'].strip():
            reason = 'missing-resolved-audio-language'
        if reason:
            issues.append({'path': path, 'issue': reason})
            continue
        if entry['review_status'] != 'pending-content-review':
            continue
        entry['review_status'] = AUDIO_LANGUAGE_AUDIT_STATUS
        entry['review_evidence'] = [
            'Toàn bộ audio đã được giải mã bằng Whisper tiny để nhận diện ngôn ngữ.',
            f"Nhận diện: {record['detected_language']} ({confidence:.3f}); kết luận kiểm tra ngôn ngữ: {record['resolved_language']}.",
        ]
        entry['review_method'] = AUDIO_LANGUAGE_AUDIT_METHOD
        entry['review_scope'] = 'complete-audio-language'
        entry['review_contexts'] = []
    return issues


def apply_source_text_audit(entries, audit):
    """Record a full source-text scan without claiming visual or auditory review."""
    if audit.get('version') != 1 or audit.get('method') != SOURCE_TEXT_AUDIT_METHOD or audit.get('scope') != SOURCE_TEXT_AUDIT_SCOPE or not isinstance(audit.get('records'), list):
        return [{'issue': 'invalid-source-text-audit'}]

    scoped_entries = [entry for entry in entries if entry['kind'] in SOURCE_TEXT_AUDIT_KINDS]
    by_path = {entry['path']: entry for entry in scoped_entries}
    records = audit['records']
    paths = Counter(record.get('path') for record in records if isinstance(record, dict) and isinstance(record.get('path'), str))
    if set(paths) != set(by_path) or any(count != 1 for count in paths.values()):
        return [{'issue': 'source-text-audit-coverage-mismatch'}]

    issues = []
    for record in records:
        path = record.get('path')
        entry = by_path.get(path)
        reason = None
        if not isinstance(path, str) or not entry:
            reason = 'source-text-audit-unknown-path'
        elif record.get('sha256') != entry['sha256']:
            reason = 'stale-source-text-audit'
        elif record.get('kind') != entry['kind']:
            reason = 'source-text-audit-kind-mismatch'
        elif record.get('han_characters') != 0:
            reason = 'han-in-source-text-audit'
        if reason:
            issues.append({'path': path, 'issue': reason})
            continue
        if entry['review_status'] != 'pending-content-review':
            continue
        entry['review_status'] = SOURCE_TEXT_AUDIT_STATUS
        entry['review_evidence'] = ['Toàn bộ văn bản nguồn đã được đọc và không chứa ký tự Hán.']
        entry['review_method'] = SOURCE_TEXT_AUDIT_METHOD
        entry['review_scope'] = 'complete-source-text'
        entry['review_contexts'] = []
    return issues


def apply_reviews(entries, ledger, source_hashes):
    issues = []
    if ledger.get('version') != 1 or not isinstance(ledger.get('reviews'), list):
        return [{'issue': 'invalid-review-ledger'}]
    records = ledger['reviews']
    paths = Counter(record.get('path') for record in records if isinstance(record, dict) and isinstance(record.get('path'), str))
    by_path = {entry['path']: entry for entry in entries}
    for record in records:
        if not isinstance(record, dict):
            issues.append({'issue': 'invalid-review-record'})
            continue
        path = record.get('path')
        entry = by_path.get(path) if isinstance(path, str) else None
        reason = None
        evidence = record.get('evidence')
        contexts = record.get('contexts')
        if not isinstance(path, str) or paths[path] != 1:
            reason = 'invalid-or-duplicate-review-path'
        elif not entry or entry['review_status'] != 'pending-content-review':
            reason = 'review-target-not-pending-asset'
        elif not isinstance(record.get('status'), str) or record['status'] not in ACCEPTED_STATUSES:
            reason = 'invalid-review-status'
        elif not entry.get('sha256') or record.get('sha256') != entry['sha256']:
            reason = 'stale-asset-review'
        elif record.get('scope') != 'complete-asset':
            reason = 'incomplete-review-scope'
        elif not isinstance(record.get('method'), str) or record['method'] not in ACCEPTED_METHODS:
            reason = 'invalid-review-method'
        elif not isinstance(evidence, list) or not evidence or not all(isinstance(v, str) and v.strip() for v in evidence):
            reason = 'missing-review-evidence'
        elif not isinstance(contexts, list) or (entry.get('references') and not contexts):
            reason = 'missing-review-context'
        elif any(not isinstance(context, dict) or not isinstance(context.get('path'), str) or context['path'] not in source_hashes or context.get('sha256') != source_hashes[context['path']] for context in contexts):
            reason = 'stale-or-missing-review-context'
        elif {context['path'] for context in contexts} != set(entry.get('references', [])):
            reason = 'review-context-coverage-changed'
        if reason:
            issues.append({'path': path, 'issue': reason})
            continue
        entry['review_status'] = record['status']
        entry['review_evidence'] = evidence
        entry['review_method'] = record['method']
        entry['review_scope'] = record['scope']
        entry['review_contexts'] = contexts
    return issues
