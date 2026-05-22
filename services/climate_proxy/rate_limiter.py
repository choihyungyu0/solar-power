"""climate.gg 보호용 sliding window 비동기 게이트."""
from __future__ import annotations

import asyncio
import time
from collections import deque


class SlidingWindowRateLimiter:
    def __init__(self, max_calls: int = 5, window_sec: float = 1.0) -> None:
        self.max_calls = max_calls
        self.window_sec = window_sec
        self._timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            while self._timestamps and now - self._timestamps[0] > self.window_sec:
                self._timestamps.popleft()
            if len(self._timestamps) >= self.max_calls:
                wait = self.window_sec - (now - self._timestamps[0])
                await asyncio.sleep(max(0.0, wait))
                now = time.monotonic()
                while self._timestamps and now - self._timestamps[0] > self.window_sec:
                    self._timestamps.popleft()
            self._timestamps.append(now)
