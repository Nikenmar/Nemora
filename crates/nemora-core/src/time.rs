//! Calendar arithmetic without a time-zone database: the core stores UTC milliseconds plus the
//! device's UTC offset at the moment of a fact, which is all a day bucket needs.

const MS_PER_DAY: i64 = 86_400_000;

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
pub fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The civil date of a day count since 1970-01-01.
pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

/// `YYYY-MM-DD` of the local day an instant falls on.
pub fn local_day(utc_ms: i64, utc_offset_min: i64) -> String {
    let local = utc_ms + utc_offset_min * 60_000;
    let (y, m, d) = civil_from_days(local.div_euclid(MS_PER_DAY));
    format!("{y:04}-{m:02}-{d:02}")
}

/// Local hour (0-23) of an instant.
pub fn local_hour(utc_ms: i64, utc_offset_min: i64) -> i64 {
    (utc_ms + utc_offset_min * 60_000).rem_euclid(MS_PER_DAY) / 3_600_000
}

/// `YYYY-MM-DD` -> days since 1970-01-01.
pub fn parse_day(day: &str) -> Option<i64> {
    let b = day.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (y, m, d) = (day[0..4].parse().ok()?, day[5..7].parse().ok()?, day[8..10].parse().ok()?);
    (1..=12).contains(&m).then(|| days_from_civil(y, m, d))
}

/// `2026-05-19T09:54:47.054Z` -> milliseconds since the epoch (UTC only, as 1.x wrote it).
/// Milliseconds since the epoch as the ISO string `JSON.stringify(new Date(ms))` gives.
pub fn iso_ms(ms: i64) -> String {
    let (y, m, d) = civil_from_days(ms.div_euclid(86_400_000));
    let rest = ms.rem_euclid(86_400_000);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rest / 3_600_000,
        rest / 60_000 % 60,
        rest / 1000 % 60,
        rest % 1000
    )
}

pub fn parse_iso_ms(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || !s.ends_with('Z') {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, sec) = (num(0..4)?, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let millis =
        if b[19] == b'.' { s[20..s.len() - 1].get(..3).and_then(|m| m.parse::<i64>().ok()).unwrap_or(0) } else { 0 };
    Some(((days_from_civil(y, mo, d) * 24 + h) * 60 + mi) * 60_000 + sec * 1000 + millis)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn civil_dates_round_trip() {
        for days in [-1_000_000, -1, 0, 1, 11_016, 20_592, 2_932_896] {
            let (y, m, d) = civil_from_days(days);
            assert_eq!(days_from_civil(y, m, d), days);
        }
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
    }

    #[test]
    fn local_day_follows_the_offset() {
        // 2026-01-01 23:30 UTC is already January 2nd in Moscow (+3) and still the 1st in New York (-5).
        let t = parse_iso_ms("2026-01-01T23:30:00.000Z").unwrap();
        assert_eq!(local_day(t, 0), "2026-01-01");
        assert_eq!(local_day(t, 180), "2026-01-02");
        assert_eq!(local_day(t, -300), "2026-01-01");
        assert_eq!(local_hour(t, 180), 2);
        assert_eq!(parse_day("2026-01-02"), Some(days_from_civil(2026, 1, 2)));
        assert_eq!(parse_day("2026-13-02"), None);
    }

    #[test]
    fn iso_dates_parse_to_epoch_millis() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-05-19T09:54:47.054Z"), Some(1_779_184_487_054));
        assert_eq!(parse_iso_ms("2000-02-29T12:00:00Z"), Some(951_825_600_000));
        assert_eq!(parse_iso_ms("not a date"), None);
    }
}
