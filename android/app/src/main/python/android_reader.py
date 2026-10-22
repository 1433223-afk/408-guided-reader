"""Small Chaquopy entry point. All business services remain in reader_service."""

import threading

from reader_service.android_local import create_reader


_lock = threading.Lock()
_reader = None


def start(data_dir, web_root, port=18765):
    global _reader
    with _lock:
        if _reader is None:
            from java import jclass
            documents = jclass("com.guidedreader.tablet.ReaderDocumentBridge")
            credentials = jclass("com.guidedreader.tablet.NativeCredentialStore")
            reader = create_reader(data_dir, web_root, documents, credentials, port=int(port))
            try:
                reader.run()
            except Exception:
                reader.stop()
                raise
            _reader = reader
        return _reader.url


def stop():
    global _reader
    with _lock:
        if _reader is not None:
            _reader.stop()
            _reader = None


def can_restore(data_dir):
    from reader_service.library_transfer import library_is_empty
    return library_is_empty(data_dir)


def restore_library(data_dir, archive_path):
    import json
    from reader_service.library_transfer import LibraryArchiveError, restore_library as restore
    with _lock:
        if _reader is not None:
            raise LibraryArchiveError("请先暂停本机阅读后再导入书库。")
        return json.dumps(restore(data_dir, archive_path), ensure_ascii=False)


def restore_library_result(data_dir, archive_path):
    import json
    from reader_service.library_transfer import LibraryArchiveError
    try:
        return restore_library(data_dir, archive_path)
    except LibraryArchiveError as error:
        return json.dumps({"restored": False, "error": str(error)}, ensure_ascii=False)
    except Exception:
        return json.dumps({"restored": False, "error": "无法导入书库，请检查迁移包后重试。"}, ensure_ascii=False)
