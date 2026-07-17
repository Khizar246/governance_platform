"""Structured logger factory with rotating file handler and request ID support.

Usage:
    from shared.logger import get_logger
    logger = get_logger("entitlement_mapping")
"""

import logging
import logging.handlers
import multiprocessing
import os
from datetime import datetime

from config import LOG_DIR

_loggers: dict[str, logging.Logger] = {}

_FMT = "%(asctime)s | %(levelname)-8s | %(name)s.%(funcName)s | %(message)s"
_DATE_FMT = "%Y-%m-%d %H:%M:%S"


def get_logger(name: str) -> logging.Logger:
    """Return (or create) a named logger that writes to logs/{name}_YYYYMMDD.log.

    File handler: DEBUG level, 10 MB max, 5 backups.
    Console handler: INFO level.
    Loggers are cached — calling this multiple times with the same name is safe.
    """
    if name in _loggers:
        return _loggers[name]

    logger = logging.getLogger(f"governance.{name}")
    logger.setLevel(logging.DEBUG)
    logger.propagate = False

    if not logger.handlers:
        LOG_DIR.mkdir(exist_ok=True)
        # Analysis-pool workers must not share the web process's file: on
        # Windows, RotatingFileHandler's rollover rename fails with
        # PermissionError while another process holds the same file open.
        pid_suffix = "" if multiprocessing.current_process().name == "MainProcess" else f"_pid{os.getpid()}"
        log_file = LOG_DIR / f"{name}_{datetime.now():%Y%m%d}{pid_suffix}.log"

        file_handler = logging.handlers.RotatingFileHandler(
            log_file, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8"
        )
        file_handler.setLevel(logging.DEBUG)

        console_handler = logging.StreamHandler()
        console_handler.setLevel(logging.INFO)

        formatter = logging.Formatter(_FMT, datefmt=_DATE_FMT)
        file_handler.setFormatter(formatter)
        console_handler.setFormatter(formatter)

        logger.addHandler(file_handler)
        logger.addHandler(console_handler)

    _loggers[name] = logger
    return logger
