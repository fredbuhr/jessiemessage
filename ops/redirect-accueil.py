#!/usr/bin/env python3
"""Apply the explicitly authorised accueil canonical redirect, once.

Only the pinned Apache condition changes. A private pre-change copy is retained;
no application, PHP version, DNS, Manager, SQL or runtime action is performed.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

CANDIDATES = (
    Path('/sites/jessiemessage-entry-1f669e45/.htaccess'),
    Path('/srv/customer/sites/jessiemessage-entry-1f669e45/.htaccess'),
)
PRIVATE = Path('/srv/customer/jessiemessage-private')
BACKUP_NAME = 'accueil-redirect-before-20261022.htaccess'
BEFORE_SHA = 'daa58abe55ca39cfb2a931f2caa8d6fc5f19e01c872e32603abc9cea8d6eff63'
OLD = rb'RewriteCond %{HTTP_HOST} ^www\.jessiemessage\.com(?::(?:80|443))?$ [NC]'
NEW = rb'RewriteCond %{HTTP_HOST} ^(?:www|accueil)\.jessiemessage\.com(?::(?:80|443))?$ [NC]'
RULE = rb'RewriteRule ^(.*)$ https://jessiemessage.com/$1 [R=308,END]'
LIMIT = 1024 * 1024


class Refused(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Refused(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def identity(value):
    return tuple(getattr(value, key) for key in ('st_dev', 'st_ino', 'st_mode',
        'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def regular(value):
    require(stat.S_ISREG(value.st_mode) and value.st_uid == os.getuid()
        and value.st_nlink == 1 and not value.st_mode & 0o022, 'SOURCE_METADATA')


def select_source():
    found = {}
    for path in CANDIDATES:
        try:
            value = path.lstat()
        except FileNotFoundError:
            continue
        regular(value)  # Refuses a final symlink, including a broken one.
        resolved = path.resolve(strict=True)
        require(identity(resolved.lstat()) == identity(value), 'SOURCE_PATH_DRIFT')
        found[(value.st_dev, value.st_ino)] = resolved
    require(len(found) == 1, 'SOURCE_NOT_FOUND' if not found else 'AMBIGUOUS_SOURCE')
    return next(iter(found.values()))


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def apply():
    target = select_source()
    directory = PRIVATE.lstat()
    require(PRIVATE.resolve(strict=True) == PRIVATE and stat.S_ISDIR(directory.st_mode)
        and directory.st_uid == os.getuid() and stat.S_IMODE(directory.st_mode) == 0o700,
        'PRIVATE_DIRECTORY')
    backup = PRIVATE / BACKUP_NAME
    require(not os.path.lexists(backup), 'BACKUP_ALREADY_EXISTS')
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    temporary = None
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = os.fstat(fd); regular(before)
        require(before.st_size <= LIMIT, 'SOURCE_LIMIT')
        original = os.pread(fd, LIMIT + 1, 0)
        require(len(original) == before.st_size and digest(original) == BEFORE_SHA, 'SOURCE_PIN')
        require(original.count(OLD) == original.count(RULE) == 1
            and OLD + b'\n' + RULE + b'\n' in original, 'CANONICAL_RULE')
        updated = original.replace(OLD, NEW, 1)

        def unchanged():
            require(identity(target.lstat()) == identity(before) == identity(os.fstat(fd))
                and os.pread(fd, LIMIT + 1, 0) == original, 'SOURCE_CHANGED')

        unchanged()
        out = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(out, 'wb') as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(original); handle.flush(); os.fsync(handle.fileno())
        sync_directory(PRIVATE)
        unchanged()
        out, temporary = tempfile.mkstemp(prefix='.htaccess-accueil-', dir=target.parent)
        with os.fdopen(out, 'wb') as handle:
            os.fchmod(handle.fileno(), stat.S_IMODE(before.st_mode))
            handle.write(updated); handle.flush(); os.fsync(handle.fileno())
        unchanged()  # Last drift check; no universal compare-and-swap is claimed.
        os.replace(temporary, target); temporary = None
        sync_directory(target.parent)
        check = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            after = os.fstat(check); regular(after)
            require(stat.S_IMODE(after.st_mode) == stat.S_IMODE(before.st_mode)
                and os.pread(check, LIMIT + 1, 0) == updated
                and identity(target.lstat()) == identity(after) == identity(os.fstat(check)),
                'READBACK_MISMATCH')
        finally:
            os.close(check)
        return dict(status='accueil_redirect_applied', target=str(target),
            beforeSha256=digest(original), afterSha256=digest(updated),
            privateBackup=str(backup), backupMode='0600', changedConditions=1,
            fixedDestination='https://jessiemessage.com', redirectStatus=308,
            pathAndQueryRulePreserved=True, httpVerified=False,
            applicationRuntimeChanged=False, sqlChanged=False, dnsChanged=False,
            managerChanged=False, phpVersionChanged=False, noRestart=True)
    finally:
        if temporary is not None:
            os.unlink(temporary)
        os.close(fd)


if __name__ == '__main__':
    try:
        require(len(__import__('sys').argv) == 1, 'USAGE')
        print(json.dumps(apply(), separators=(',', ':')))
    except Exception as error:
        code = str(error) if isinstance(error, Refused) else 'ROUTING_NOT_CONFIRMED'
        print(json.dumps(dict(status='accueil_redirect_unconfirmed', code=code,
            noAutomaticRetry=True), separators=(',', ':')))
        raise SystemExit(1)
