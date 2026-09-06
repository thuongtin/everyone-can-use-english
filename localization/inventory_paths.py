"""Discover repository paths and read regular files without following symlinks."""

from pathlib import Path
import os
import stat
import subprocess


MEDIA_EXTENSIONS = {
    '.mp3', '.mp4', '.wav', '.aiff', '.png', '.svg', '.jpg', '.jpeg', '.gif',
    '.webp', '.pdf', '.ico', '.icns', '.ttf', '.woff', '.woff2', '.zip',
    '.ipynb', '.alfredworkflow',
}
TEXT_EXTENSIONS = {
    '.md', '.mdx', '.txt', '.rst', '.html', '.htm', '.vue', '.tsx', '.ts',
    '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.json', '.jsonc', '.yml',
    '.yaml', '.toml', '.xml', '.css', '.scss', '.sass', '.less', '.py', '.go',
    '.sh', '.zsh', '.sql', '.csv', '.srt', '.vtt', '.applescript', '.metal',
    '.lock',
}

SENSITIVE_NAMES = {
    '.npmrc', '.pypirc', '.netrc', 'auth.json', 'credentials.json',
    'secrets.json', 'service-account.json', 'secrets', 'credentials',
    'private',
}
SENSITIVE_SUFFIXES = {
    '.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.der',
}
SENSITIVE_PREFIXES = (
    'secret', 'credential', 'credentials', 'secrets', 'password', 'passwd',
    'token', 'private',
)

REFERENCE_EXCLUDED_PREFIXES = (
    Path('localization'),
    Path('docs/superpowers'),
)
REFERENCE_EXCLUDED_FILES = {
    Path('execution-notes.md'),
}


class UnsafePathError(ValueError):
    """Raised when a path is sensitive, a symlink, or is not a regular file."""


def _relative_path(path):
    """Return a normalized relative Path or raise for an unsafe repository path."""
    relative = Path(path)
    if relative.is_absolute() or '..' in relative.parts:
        raise UnsafePathError(f'Invalid repository-relative path: {relative}')
    return relative


def is_sensitive(path):
    """Return whether a path name is likely to contain credentials or secrets."""
    relative = Path(path)
    for part in relative.parts:
        lower = part.lower()
        if lower == '.env' or lower.startswith('.env.'):
            return True
        if lower in SENSITIVE_NAMES or lower.endswith(tuple(SENSITIVE_SUFFIXES)):
            return True
        for prefix in SENSITIVE_PREFIXES:
            if lower == prefix:
                return True
            if lower.startswith(prefix) and lower[len(prefix):len(prefix) + 1] in {'.', '-', '_'}:
                return True
    return False


def is_reference_path(path):
    """Return whether a repository path may be searched for media references."""
    relative = Path(path)
    if relative in REFERENCE_EXCLUDED_FILES:
        return False
    for prefix in REFERENCE_EXCLUDED_PREFIXES:
        if relative == prefix or prefix in relative.parents:
            return False
    return True


def discover_paths(root, include_untracked=True):
    """List Git paths without staging the worktree."""
    root = Path(root)
    command = ['git', 'ls-files', '--cached']
    if include_untracked:
        command.extend(['--others', '--exclude-standard'])
    command.extend(['-z', '--'])
    output = subprocess.check_output(
        command,
        cwd=root,
    )
    names = output.split(b'\0')
    paths = []
    for name in names:
        if not name:
            continue
        paths.append(Path(os.fsdecode(name)))
    return sorted(set(paths), key=lambda path: path.as_posix())


def path_status(root, path):
    """Classify a repository path using lstat at every path component."""
    root = Path(root)
    try:
        relative = _relative_path(path)
    except UnsafePathError:
        return 'invalid-path'

    current = root
    try:
        root_stat = os.lstat(current)
    except OSError:
        return 'missing'
    if stat.S_ISLNK(root_stat.st_mode):
        return 'symlink'

    parts = relative.parts
    for index, part in enumerate(parts):
        current /= part
        try:
            current_stat = os.lstat(current)
        except FileNotFoundError:
            return 'missing'
        except OSError:
            return 'unreadable'
        if stat.S_ISLNK(current_stat.st_mode):
            return 'symlink'
        if index < len(parts) - 1:
            if not stat.S_ISDIR(current_stat.st_mode):
                return 'non-directory'
        elif stat.S_ISREG(current_stat.st_mode):
            return 'regular'
        else:
            return 'non-regular'
    return 'non-regular'


def read_bytes(root, path):
    """Read a regular, non-sensitive repository file with O_NOFOLLOW."""
    root = Path(root)
    relative = _relative_path(path)
    if is_sensitive(relative):
        raise UnsafePathError(f'Sensitive path was not read: {relative}')
    if path_status(root, relative) != 'regular':
        raise UnsafePathError(f'Unsafe path was not read: {relative}')

    target = root.joinpath(*relative.parts)
    flags = os.O_RDONLY
    flags |= getattr(os, 'O_NOFOLLOW', 0)
    file_descriptor = os.open(target, flags)
    try:
        descriptor_stat = os.fstat(file_descriptor)
        if not stat.S_ISREG(descriptor_stat.st_mode):
            raise UnsafePathError(f'Non-regular path was not read: {relative}')
        with os.fdopen(file_descriptor, 'rb') as stream:
            file_descriptor = None
            return stream.read()
    finally:
        if file_descriptor is not None:
            os.close(file_descriptor)


def classify_path(root, path):
    """Classify a path before any content read or hash operation."""
    relative = Path(path)
    if is_sensitive(relative):
        return 'sensitive'
    return path_status(root, relative)
