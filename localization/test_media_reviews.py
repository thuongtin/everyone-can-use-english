"""Ensure stale or incomplete evidence cannot mark media as reviewed."""
import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
import zipfile
from unittest import mock

try:
    from . import inventory_media as inventory_media_module
    from .inventory_media import build_inventory
    from .inventory_paths import UnsafePathError, read_bytes
    from .media_reviews import (
        AUDIO_LANGUAGE_AUDIT_SCOPE,
        SOURCE_TEXT_AUDIT_SCOPE,
        apply_audio_language_audit,
        apply_reviews,
        apply_source_text_audit,
    )
except ImportError:
    import inventory_media as inventory_media_module
    from inventory_media import build_inventory
    from inventory_paths import UnsafePathError, read_bytes
    from media_reviews import (
        AUDIO_LANGUAGE_AUDIT_SCOPE,
        SOURCE_TEXT_AUDIT_SCOPE,
        apply_audio_language_audit,
        apply_reviews,
        apply_source_text_audit,
    )


class ReviewEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.entries = [{'path': 'image.png', 'sha256': 'asset-v1', 'review_status': 'pending-content-review', 'review_evidence': [], 'references': ['page.md']}]
        self.record = {'path': 'image.png', 'sha256': 'asset-v1', 'status': 'reviewed-keep-original', 'scope': 'complete-asset', 'method': 'visual-full-image-and-context', 'evidence': ['Full image and translated caption inspected.'], 'contexts': [{'path': 'page.md', 'sha256': 'page-v1'}]}

    def apply(self, records=None, sources=None):
        return apply_reviews(self.entries, {'version': 1, 'reviews': records if records is not None else [self.record]}, sources if sources is not None else {'page.md': 'page-v1'})

    def test_matching_asset_and_context_preserve_evidence(self):
        self.assertEqual(self.apply(), [])
        self.assertEqual(self.entries[0]['review_status'], 'reviewed-keep-original')
        self.assertEqual(self.entries[0]['review_evidence'], self.record['evidence'])

    def test_replacing_asset_invalidates_review(self):
        self.entries[0]['sha256'] = 'asset-v2'
        self.assertEqual(self.apply()[0]['issue'], 'stale-asset-review')
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')

    def test_changing_or_removing_context_invalidates_review(self):
        for sources in [{'page.md': 'page-v2'}, {}]:
            with self.subTest(sources=sources):
                self.assertEqual(self.apply(sources=sources)[0]['issue'], 'stale-or-missing-review-context')
                self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')

    def test_duplicate_or_incomplete_evidence_stays_pending(self):
        self.assertEqual(len(self.apply(records=[self.record, copy.deepcopy(self.record)])), 2)
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')
        self.record['evidence'] = []
        self.assertEqual(self.apply()[0]['issue'], 'missing-review-evidence')
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')


    def test_invalid_schema_does_not_abort_other_records(self):
        invalid_path = copy.deepcopy(self.record)
        invalid_path['path'] = []
        invalid_status = copy.deepcopy(self.record)
        invalid_status.update(path='other.png', status=[])
        self.entries.append({'path': 'other.png', 'sha256': 'asset-v1', 'review_status': 'pending-content-review'})
        issues = self.apply(records=[invalid_path, self.record, invalid_status])
        self.assertEqual([issue['issue'] for issue in issues], ['invalid-or-duplicate-review-path', 'invalid-review-status'])
        self.assertEqual(self.entries[0]['review_status'], 'reviewed-keep-original')
        self.assertEqual(self.entries[1]['review_status'], 'pending-content-review')

    def test_invalid_or_unknown_review_method_stays_pending(self):
        for method in [1, ' ', [], 'guess']:
            with self.subTest(method=method):
                self.record['method'] = method
                self.assertEqual(self.apply()[0]['issue'], 'invalid-review-method')
                self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')

    def test_new_or_unrelated_context_requires_review(self):
        self.entries[0]['references'].append('new-page.md')
        self.assertEqual(self.apply()[0]['issue'], 'review-context-coverage-changed')
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')
        self.entries[0]['references'] = ['different-page.md']
        self.assertEqual(self.apply()[0]['issue'], 'review-context-coverage-changed')
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')

    def test_unreferenced_replaced_video_can_keep_complete_review_evidence(self):
        self.entries = [{
            'path': 'video.mp4',
            'sha256': 'video-v1',
            'review_status': 'pending-content-review',
            'review_evidence': [],
            'references': [],
        }]
        record = {
            'path': 'video.mp4',
            'sha256': 'video-v1',
            'status': 'reviewed-translated',
            'scope': 'complete-asset',
            'method': 'visual-full-video-and-replaced-audio',
            'evidence': ['Every visual frame and the replacement audio were reviewed.'],
            'contexts': [],
        }
        self.assertEqual(apply_reviews(self.entries, {'version': 1, 'reviews': [record]}, {}), [])
        self.assertEqual(self.entries[0]['review_status'], 'reviewed-translated')

    def test_full_asr_audio_review_can_keep_intentional_source_audio(self):
        self.entries = [{
            'path': 'comparison.mp3',
            'sha256': 'audio-v1',
            'review_status': 'pending-content-review',
            'review_evidence': [],
            'references': ['lesson.md'],
        }]
        record = {
            'path': 'comparison.mp3',
            'sha256': 'audio-v1',
            'status': 'reviewed-keep-original',
            'scope': 'complete-asset',
            'method': 'asr-full-audio-and-context',
            'evidence': ['ASR transcript and Vietnamese lesson context were inspected.'],
            'contexts': [{'path': 'lesson.md', 'sha256': 'lesson-v1'}],
        }
        self.assertEqual(apply_reviews(self.entries, {'version': 1, 'reviews': [record]}, {'lesson.md': 'lesson-v1'}), [])
        self.assertEqual(self.entries[0]['review_status'], 'reviewed-keep-original')

    def test_matching_full_audio_language_audit_marks_language_only(self):
        self.entries = [{
            'path': '1000-hours/public/audios/example.mp3',
            'kind': '.mp3',
            'sha256': 'audio-v1',
            'review_status': 'pending-content-review',
            'review_evidence': [],
            'references': ['lesson.md'],
        }]
        audit = {
            'version': 1,
            'method': 'echogarden-whisper-tiny-language-detection',
            'scope': AUDIO_LANGUAGE_AUDIT_SCOPE,
            'records': [{
                'path': '1000-hours/public/audios/example.mp3',
                'sha256': 'audio-v1',
                'detected_language': 'en',
                'detected_confidence': 0.99,
                'resolved_language': 'en',
            }],
        }
        self.assertEqual(apply_audio_language_audit(self.entries, audit), [])
        self.assertEqual(self.entries[0]['review_status'], 'reviewed-language-audit')
        self.assertEqual(self.entries[0]['review_scope'], 'complete-audio-language')

    def test_stale_or_incomplete_audio_language_audit_stays_pending(self):
        self.entries = [{
            'path': '1000-hours/public/audios/example.mp3',
            'kind': '.mp3',
            'sha256': 'audio-v2',
            'review_status': 'pending-content-review',
            'review_evidence': [],
            'references': [],
        }]
        audit = {
            'version': 1,
            'method': 'echogarden-whisper-tiny-language-detection',
            'scope': AUDIO_LANGUAGE_AUDIT_SCOPE,
            'records': [{
                'path': '1000-hours/public/audios/example.mp3',
                'sha256': 'audio-v1',
                'detected_language': 'en',
                'detected_confidence': 0.99,
                'resolved_language': 'en',
            }],
        }
        self.assertEqual(apply_audio_language_audit(self.entries, audit)[0]['issue'], 'stale-audio-language-audit')
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')
        audit['records'] = []
        self.assertEqual(apply_audio_language_audit(self.entries, audit)[0]['issue'], 'audio-language-audit-coverage-mismatch')
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')

    def test_source_text_audit_requires_matching_full_svg_or_notebook_set(self):
        self.entries = [{
            'path': 'diagram.svg',
            'kind': '.svg',
            'sha256': 'svg-v1',
            'review_status': 'pending-content-review',
            'review_evidence': [],
            'references': [],
        }]
        audit = {
            'version': 1,
            'method': 'source-full-text-no-han',
            'scope': SOURCE_TEXT_AUDIT_SCOPE,
            'records': [{'path': 'diagram.svg', 'kind': '.svg', 'sha256': 'svg-v1', 'han_characters': 0}],
        }
        self.assertEqual(apply_source_text_audit(self.entries, audit), [])
        self.assertEqual(self.entries[0]['review_status'], 'reviewed-source-text-audit')
        self.entries[0]['review_status'] = 'pending-content-review'
        audit['records'][0]['sha256'] = 'svg-v2'
        self.assertEqual(apply_source_text_audit(self.entries, audit)[0]['issue'], 'stale-source-text-audit')
        self.assertEqual(self.entries[0]['review_status'], 'pending-content-review')


class InventoryPathTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.external_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self._git('init', '-q')
        self._git('config', 'user.email', 'test@example.invalid')
        self._git('config', 'user.name', 'Inventory Test')
        self._write('product/tracked.png', b'tracked-media')
        self._write('product/symlink-dir/hidden.mp3', b'symlink-directory-media')
        self._write('product/page.md', 'tracked.png\nuntracked.mp3\nignored.mp3\n.env.mp3\nlink.mp3\nhidden.mp3\n')
        self._write('.gitignore', 'product/ignored.mp3\n')
        self._write('localization/notes.md', 'untracked.mp3 tracked.png\n')
        self._write('docs/superpowers/plan.md', 'untracked.mp3 tracked.png\n')
        self._write('execution-notes.md', 'untracked.mp3 tracked.png\n')
        self._write('localization/media-inventory.json', json.dumps({'paths': ['untracked.mp3']}))
        self._write('localization/media-reviews.json', '{"version": 1, "reviews": []}\n')
        self._git('add', '.')
        self._git('commit', '-qm', 'fixture')
        self._write('product/untracked.mp3', b'untracked-media')
        self._write('product/ignored.mp3', b'ignored-media')
        self._write('product/.env.mp3', b'fake-secret-media')
        self._write('product/credentials.json', 'untracked.mp3\n')
        external_media = Path(self.external_directory.name) / 'hidden.mp3'
        external_media.write_bytes(b'external-media')
        try:
            os.symlink('untracked.mp3', self.root / 'product/link.mp3')
            shutil.rmtree(self.root / 'product/symlink-dir')
            os.symlink(self.external_directory.name, self.root / 'product/symlink-dir')
        except OSError as error:
            self.temporary_directory.cleanup()
            self.external_directory.cleanup()
            self.skipTest(f'Symlink fixture unavailable: {error}')

    def tearDown(self):
        self.temporary_directory.cleanup()
        self.external_directory.cleanup()

    def _git(self, *arguments):
        return subprocess.run(
            ['git', *arguments],
            cwd=self.root,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def _write(self, relative, content):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content)

    def test_inventory_covers_untracked_media_and_excludes_unsafe_paths(self):
        reads = []
        actual_read_bytes = inventory_media_module.read_bytes

        def read_spy(root, path):
            reads.append(Path(path).as_posix())
            return actual_read_bytes(root, path)

        with mock.patch.object(inventory_media_module, 'read_bytes', side_effect=read_spy):
            output = build_inventory(self.root, self.root / 'inventory-output.json')
        entries = {entry['path']: entry for entry in output['entries']}

        self.assertIn('product/tracked.png', entries)
        self.assertIn('product/untracked.mp3', entries)
        self.assertNotIn('product/ignored.mp3', entries)
        self.assertEqual(entries['product/.env.mp3']['review_status'], 'skipped-sensitive')
        self.assertNotIn('sha256', entries['product/.env.mp3'])
        self.assertEqual(entries['product/link.mp3']['review_status'], 'skipped-symlink')
        self.assertNotIn('sha256', entries['product/link.mp3'])
        self.assertEqual(entries['product/symlink-dir/hidden.mp3']['review_status'], 'skipped-symlink')
        self.assertNotIn('sha256', entries['product/symlink-dir/hidden.mp3'])
        self.assertNotIn('product/credentials.json', reads)
        self.assertNotIn('product/symlink-dir/hidden.mp3', reads)
        self.assertEqual(output['summary']['tracked_containers_and_assets'], 2)
        self.assertEqual(output['summary']['tracked_and_unignored_containers_and_assets'], 5)

        references = entries['product/untracked.mp3']['references']
        self.assertIn('product/page.md', references)
        self.assertNotIn('product/credentials.json', references)
        for excluded in ('localization/notes.md', 'docs/superpowers/plan.md', 'execution-notes.md'):
            self.assertNotIn(excluded, references)

        with self.assertRaises(UnsafePathError):
            read_bytes(self.root, Path('product/link.mp3'))
        self.assertTrue((self.root / 'inventory-output.json').is_file())

    def test_archive_skips_sensitive_and_symlink_members_before_reading(self):
        archive_path = self.root / 'product/bundle.zip'
        with zipfile.ZipFile(archive_path, 'w') as archive:
            archive.writestr('safe.png', b'safe-media')
            archive.writestr('.env', b'fake-secret')
            symlink = zipfile.ZipInfo('linked.png')
            symlink.create_system = 3
            symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
            archive.writestr(symlink, b'product/untracked.mp3')

        output = build_inventory(self.root)
        entries = {entry['path']: entry for entry in output['entries']}
        self.assertIn('product/bundle.zip!/safe.png', entries)
        self.assertEqual(entries['product/bundle.zip!/.env']['review_status'], 'skipped-sensitive')
        self.assertNotIn('sha256', entries['product/bundle.zip!/.env'])
        self.assertEqual(entries['product/bundle.zip!/linked.png']['review_status'], 'skipped-symlink')
        self.assertNotIn('sha256', entries['product/bundle.zip!/linked.png'])

    def test_oversized_skipped_archive_members_are_never_read(self):
        archive_path = self.root / 'product/fake-bundle.zip'
        archive_path.write_bytes(b'fake-archive')
        read_members = []

        class FakeMember:
            def __init__(self, filename, file_size, external_attr=0):
                self.filename = filename
                self.file_size = file_size
                self.external_attr = external_attr

            def is_dir(self):
                return False

        class FakeArchive:
            def __init__(self):
                self.members = [
                    FakeMember('.env', 100_000_001),
                    FakeMember('linked.png', 100_000_001, (stat.S_IFLNK | 0o777) << 16),
                    FakeMember('safe.png', 1),
                ]

            def __enter__(self):
                return self

            def __exit__(self, exception_type, exception, traceback):
                return False

            def infolist(self):
                return self.members

            def read(self, member):
                read_members.append(member.filename)
                if member.filename != 'safe.png':
                    raise AssertionError(f'Unsafe archive member was read: {member.filename}')
                return b'safe-media'

        fake_archive = FakeArchive()
        with mock.patch.object(inventory_media_module.zipfile, 'ZipFile', return_value=fake_archive):
            output = build_inventory(self.root)
        entries = {entry['path']: entry for entry in output['entries']}

        self.assertEqual(read_members, ['safe.png'])
        self.assertEqual(entries['product/fake-bundle.zip!/.env']['review_status'], 'skipped-sensitive')
        self.assertNotIn('sha256', entries['product/fake-bundle.zip!/.env'])
        self.assertEqual(entries['product/fake-bundle.zip!/linked.png']['review_status'], 'skipped-symlink')
        self.assertNotIn('sha256', entries['product/fake-bundle.zip!/linked.png'])

    def test_embedded_data_uri_and_archive_review_use_discovered_parent_hashes(self):
        embedded_payload = b'embedded-data-uri-media'
        page_path = self.root / 'product/page.md'
        page_path.write_text(
            page_path.read_text()
            + f"data:image/png;base64,{base64.b64encode(embedded_payload).decode()}\n"
        )

        archive_path = self.root / 'product/review-bundle.zip'
        archive_payload = b'archive-review-media'
        with zipfile.ZipFile(archive_path, 'w') as archive:
            archive.writestr('preview.png', archive_payload)

        page_sha256 = hashlib.sha256(page_path.read_bytes()).hexdigest()
        archive_sha256 = hashlib.sha256(archive_path.read_bytes()).hexdigest()
        ledger = {
            'version': 1,
            'reviews': [
                {
                    'path': 'product/page.md#data-uri/0/image/png',
                    'sha256': hashlib.sha256(embedded_payload).hexdigest(),
                    'status': 'reviewed-keep-original',
                    'scope': 'complete-asset',
                    'method': 'visual-full-image-and-context',
                    'evidence': ['Embedded image payload and source context were inspected.'],
                    'contexts': [{'path': 'product/page.md', 'sha256': page_sha256}],
                },
                {
                    'path': 'product/review-bundle.zip!/preview.png',
                    'sha256': hashlib.sha256(archive_payload).hexdigest(),
                    'status': 'reviewed-keep-original',
                    'scope': 'complete-asset',
                    'method': 'visual-full-image-and-context',
                    'evidence': ['Archive member and safe archive parent were inspected.'],
                    'contexts': [{'path': 'product/review-bundle.zip', 'sha256': archive_sha256}],
                },
            ],
        }
        self._write('localization/media-reviews.json', json.dumps(ledger))

        output = build_inventory(self.root)
        entries = {entry['path']: entry for entry in output['entries']}

        self.assertEqual(entries['product/page.md#data-uri/0/image/png']['review_status'], 'reviewed-keep-original')
        self.assertEqual(entries['product/review-bundle.zip!/preview.png']['review_status'], 'reviewed-keep-original')
        self.assertEqual(output['content_review_issues'], [])

    def test_unsafe_archive_parent_is_not_read_or_added_to_context_hashes(self):
        external_archive = Path(self.external_directory.name) / 'unsafe.zip'
        with zipfile.ZipFile(external_archive, 'w') as archive:
            archive.writestr('hidden.png', b'external-media')
        unsafe_parent = self.root / 'product/unsafe.zip'
        try:
            os.symlink(external_archive, unsafe_parent)
        except OSError as error:
            self.skipTest(f'Symlink fixture unavailable: {error}')
        sensitive_parent = self.root / 'product/.env.zip'
        sensitive_parent.write_bytes(b'sensitive-archive')

        tracked_payload = (self.root / 'product/tracked.png').read_bytes()
        ledger = {
            'version': 1,
            'reviews': [{
                'path': 'product/tracked.png',
                'sha256': hashlib.sha256(tracked_payload).hexdigest(),
                'status': 'reviewed-keep-original',
                'scope': 'complete-asset',
                'method': 'visual-full-image-and-context',
                'evidence': ['Safe asset was inspected with an unsafe parent context fixture.'],
                'contexts': [{'path': 'product/unsafe.zip', 'sha256': 'must-not-be-hashed'}],
            }],
        }
        self._write('localization/media-reviews.json', json.dumps(ledger))

        reads = []
        captured_source_hashes = {}
        actual_read_bytes = inventory_media_module.read_bytes
        actual_apply_reviews = inventory_media_module.apply_reviews

        def read_spy(root, path):
            reads.append(Path(path).as_posix())
            return actual_read_bytes(root, path)

        def apply_spy(entries, ledger, source_hashes):
            captured_source_hashes.update(source_hashes)
            return actual_apply_reviews(entries, ledger, source_hashes)

        with mock.patch.object(inventory_media_module, 'read_bytes', side_effect=read_spy):
            with mock.patch.object(inventory_media_module, 'apply_reviews', side_effect=apply_spy):
                output = build_inventory(self.root)
        entries = {entry['path']: entry for entry in output['entries']}

        self.assertEqual(entries['product/unsafe.zip']['review_status'], 'skipped-symlink')
        self.assertEqual(entries['product/.env.zip']['review_status'], 'skipped-sensitive')
        self.assertNotIn('sha256', entries['product/unsafe.zip'])
        self.assertNotIn('sha256', entries['product/.env.zip'])
        self.assertNotIn('product/unsafe.zip', reads)
        self.assertNotIn('product/.env.zip', reads)
        self.assertNotIn('product/unsafe.zip', captured_source_hashes)
        self.assertNotIn('product/.env.zip', captured_source_hashes)
        self.assertEqual(output['content_review_issues'][0]['issue'], 'stale-or-missing-review-context')


if __name__ == '__main__':
    unittest.main()
