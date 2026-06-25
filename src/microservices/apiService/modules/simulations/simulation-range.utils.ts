import dayjs from 'dayjs';

export type WindowRange = {
  startedAt: Date;
  endedAt: Date;
};

export function buildDailyRanges(startAt: Date, endAt: Date): WindowRange[] {
  const ranges: WindowRange[] = [];
  let cursor = dayjs(startAt).startOf('day');
  const end = dayjs(endAt).startOf('day');

  while (cursor.isBefore(end)) {
    const nextCursor = cursor.add(1, 'day');
    ranges.push({
      startedAt: cursor.toDate(),
      endedAt: nextCursor.isAfter(end) ? end.toDate() : nextCursor.toDate(),
    });
    cursor = nextCursor;
  }

  return ranges;
}

export function getRangeKey(range: WindowRange) {
  return dayjs(range.startedAt).format('YYYY-MM-DD');
}
