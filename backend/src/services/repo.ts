import type { Db } from "../db/index.js";
import type { AlertOutcome, AlertState } from "../domain/alertRules.js";
import type { SourceStatusRow } from "../domain/status.js";
import {
  DEFAULT_SETTINGS,
  type Category,
  type EventDirection,
  type LonLat,
  type NotificationSettings,
  type ScheduleRule,
  type Segment,
  type TrafficEvent,
  type TravelTime,
} from "../domain/types.js";
import type { SourceSnapshot } from "../traffic/types.js";

/* Alle SQL-spørringer samlet ett sted. Hver funksjon som tar userId sjekker eierskap. */

export async function ensureUser(db: Db, email: string): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email.toLowerCase()],
  );
  return rows[0]!.id;
}

export async function listUserIds(db: Db): Promise<string[]> {
  return (await db.query<{ id: string }>("SELECT id FROM users")).map((r) => r.id);
}

// ---------- Lister og strekninger ----------

export interface WatchList {
  id: string;
  name: string;
  active: boolean;
  schedule: ScheduleRule[];
}

export interface SegmentRow extends Segment {
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  geometryNote: string | null;
  sortOrder: number;
}

interface SegmentDbRow {
  id: string;
  list_id: string;
  name: string;
  road_number: string;
  road_numbers: string[];
  start_name: string;
  start_lat: number;
  start_lon: number;
  end_name: string;
  end_lat: number;
  end_lon: number;
  direction: "forward" | "both";
  buffer_m: number;
  geometry: LonLat[];
  geometry_source: "nvdb" | "straight";
  geometry_note: string | null;
  active: boolean;
  sort_order: number;
}

function toSegment(r: SegmentDbRow): SegmentRow {
  return {
    id: r.id,
    listId: r.list_id,
    name: r.name,
    roadNumber: r.road_number,
    roadNumbers: r.road_numbers,
    startName: r.start_name,
    startLat: r.start_lat,
    startLon: r.start_lon,
    endName: r.end_name,
    endLat: r.end_lat,
    endLon: r.end_lon,
    direction: r.direction,
    bufferM: r.buffer_m,
    geometry: r.geometry,
    geometrySource: r.geometry_source,
    geometryNote: r.geometry_note,
    active: r.active,
    sortOrder: r.sort_order,
  };
}

export async function getLists(db: Db, userId: string): Promise<WatchList[]> {
  return db.query<WatchList>(
    "SELECT id, name, active, schedule FROM watch_lists WHERE user_id = $1 ORDER BY created_at",
    [userId],
  );
}

export async function getList(db: Db, userId: string, listId: string): Promise<WatchList | null> {
  const rows = await db.query<WatchList>(
    "SELECT id, name, active, schedule FROM watch_lists WHERE id = $1 AND user_id = $2",
    [listId, userId],
  );
  return rows[0] ?? null;
}

export async function createList(db: Db, userId: string, input: Omit<WatchList, "id">): Promise<WatchList> {
  const rows = await db.query<WatchList>(
    `INSERT INTO watch_lists (user_id, name, active, schedule) VALUES ($1, $2, $3, $4)
     RETURNING id, name, active, schedule`,
    [userId, input.name, input.active, JSON.stringify(input.schedule)],
  );
  return rows[0]!;
}

export async function updateList(
  db: Db,
  userId: string,
  listId: string,
  input: Partial<Omit<WatchList, "id">>,
): Promise<WatchList | null> {
  const rows = await db.query<WatchList>(
    `UPDATE watch_lists SET
       name = COALESCE($3, name),
       active = COALESCE($4, active),
       schedule = COALESCE($5::jsonb, schedule),
       updated_at = now()
     WHERE id = $1 AND user_id = $2
     RETURNING id, name, active, schedule`,
    [listId, userId, input.name ?? null, input.active ?? null, input.schedule ? JSON.stringify(input.schedule) : null],
  );
  return rows[0] ?? null;
}

export async function deleteList(db: Db, userId: string, listId: string): Promise<boolean> {
  const rows = await db.query("DELETE FROM watch_lists WHERE id = $1 AND user_id = $2 RETURNING id", [listId, userId]);
  return rows.length > 0;
}

export async function getSegments(db: Db, userId: string, listId?: string): Promise<SegmentRow[]> {
  const rows = await db.query<SegmentDbRow>(
    `SELECT s.* FROM segments s JOIN watch_lists l ON l.id = s.list_id
     WHERE l.user_id = $1 AND ($2::uuid IS NULL OR s.list_id = $2)
     ORDER BY s.sort_order, s.created_at`,
    [userId, listId ?? null],
  );
  return rows.map(toSegment);
}

export async function getSegment(db: Db, userId: string, segmentId: string): Promise<SegmentRow | null> {
  const rows = await db.query<SegmentDbRow>(
    `SELECT s.* FROM segments s JOIN watch_lists l ON l.id = s.list_id
     WHERE s.id = $1 AND l.user_id = $2`,
    [segmentId, userId],
  );
  return rows[0] ? toSegment(rows[0]) : null;
}

export type SegmentInput = Omit<SegmentRow, "id" | "listId" | "sortOrder">;

export async function createSegment(db: Db, listId: string, s: SegmentInput): Promise<SegmentRow> {
  const rows = await db.query<SegmentDbRow>(
    `INSERT INTO segments (list_id, name, road_number, start_name, start_lat, start_lon, end_name, end_lat, end_lon,
       direction, buffer_m, geometry, geometry_source, geometry_note, active, road_numbers, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM segments WHERE list_id = $1))
     RETURNING *`,
    [
      listId, s.name, s.roadNumber, s.startName, s.startLat, s.startLon, s.endName, s.endLat, s.endLon,
      s.direction, s.bufferM, JSON.stringify(s.geometry), s.geometrySource, s.geometryNote, s.active,
      JSON.stringify(s.roadNumbers ?? []),
    ],
  );
  return toSegment(rows[0]!);
}

export async function updateSegment(db: Db, segmentId: string, s: SegmentInput): Promise<SegmentRow> {
  const rows = await db.query<SegmentDbRow>(
    `UPDATE segments SET name=$2, road_number=$3, start_name=$4, start_lat=$5, start_lon=$6, end_name=$7,
       end_lat=$8, end_lon=$9, direction=$10, buffer_m=$11, geometry=$12, geometry_source=$13,
       geometry_note=$14, active=$15, road_numbers=$16, updated_at=now()
     WHERE id = $1 RETURNING *`,
    [
      segmentId, s.name, s.roadNumber, s.startName, s.startLat, s.startLon, s.endName, s.endLat, s.endLon,
      s.direction, s.bufferM, JSON.stringify(s.geometry), s.geometrySource, s.geometryNote, s.active,
      JSON.stringify(s.roadNumbers ?? []),
    ],
  );
  return toSegment(rows[0]!);
}

export async function setSegmentActive(db: Db, segmentId: string, active: boolean): Promise<void> {
  await db.query("UPDATE segments SET active = $2, updated_at = now() WHERE id = $1", [segmentId, active]);
}

export async function deleteSegment(db: Db, userId: string, segmentId: string): Promise<boolean> {
  const rows = await db.query(
    `DELETE FROM segments s USING watch_lists l
     WHERE s.list_id = l.id AND s.id = $1 AND l.user_id = $2 RETURNING s.id`,
    [segmentId, userId],
  );
  return rows.length > 0;
}

// ---------- Varslingsinnstillinger og push ----------

export async function getSettings(db: Db, userId: string): Promise<NotificationSettings> {
  const rows = await db.query<{
    push_enabled: boolean;
    email_enabled: boolean;
    email: string | null;
    event_types: Category[];
    delay_threshold_min: number;
    notify_on_resolved: boolean;
    include_unknown_direction: boolean;
    disabled_sources: string[];
  }>("SELECT * FROM notification_settings WHERE user_id = $1", [userId]);
  const r = rows[0];
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    pushEnabled: r.push_enabled,
    emailEnabled: r.email_enabled,
    email: r.email,
    eventTypes: r.event_types,
    delayThresholdMin: r.delay_threshold_min,
    notifyOnResolved: r.notify_on_resolved,
    includeUnknownDirection: r.include_unknown_direction,
    disabledSources: r.disabled_sources ?? [],
  };
}

export async function saveSettings(db: Db, userId: string, s: NotificationSettings): Promise<void> {
  await db.query(
    `INSERT INTO notification_settings (user_id, push_enabled, email_enabled, email, event_types,
       delay_threshold_min, notify_on_resolved, include_unknown_direction, disabled_sources, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (user_id) DO UPDATE SET push_enabled=$2, email_enabled=$3, email=$4, event_types=$5,
       delay_threshold_min=$6, notify_on_resolved=$7, include_unknown_direction=$8, disabled_sources=$9,
       updated_at=now()`,
    [
      userId, s.pushEnabled, s.emailEnabled, s.email, JSON.stringify(s.eventTypes),
      s.delayThresholdMin, s.notifyOnResolved, s.includeUnknownDirection, JSON.stringify(s.disabledSources),
    ],
  );
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function addPushSubscription(
  db: Db,
  userId: string,
  sub: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id=$1, p256dh=$3, auth=$4, user_agent=$5, failure_count=0`,
    [userId, sub.endpoint, sub.p256dh, sub.auth, sub.userAgent],
  );
}

export async function removePushSubscription(db: Db, userId: string, endpoint: string): Promise<void> {
  await db.query("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [userId, endpoint]);
}

export async function getPushSubscriptions(db: Db, userId: string): Promise<PushSubscriptionRow[]> {
  return db.query<PushSubscriptionRow>(
    "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1",
    [userId],
  );
}

export async function countPushSubscriptions(db: Db, userId: string): Promise<number> {
  const rows = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1", [userId]);
  return rows[0]?.n ?? 0;
}

export async function markPushResult(db: Db, id: string, ok: boolean, gone: boolean): Promise<void> {
  if (gone) {
    await db.query("DELETE FROM push_subscriptions WHERE id = $1", [id]);
  } else if (ok) {
    await db.query("UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0 WHERE id = $1", [id]);
  } else {
    await db.query("UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = $1", [id]);
  }
}

// ---------- Trafikkdata ----------

/**
 * Lagrer et komplett øyeblikksbilde. Det som ikke lenger finnes i kilden
 * merkes "gone". Kjøreretning beholdes så lenge kildeversjonen er uendret.
 */
export async function storeSnapshot(db: Db, sourceId: string, snap: SourceSnapshot): Promise<void> {
  const now = snap.fetchedAt;
  await db.transaction(async (tx) => {
    for (const e of snap.events) {
      await tx.query(
        `INSERT INTO traffic_events (id, source, source_id, version, category, situation_type, secondary_types,
           severity, title, description, road_numbers, geometry, direction, reported_delay_min, start_time,
           end_time, active_periods, source_updated_at, first_seen_at, last_seen_at, status, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19,'present',$20)
         ON CONFLICT (id) DO UPDATE SET
           direction = CASE WHEN traffic_events.version = EXCLUDED.version AND traffic_events.direction_checked IS NOT NULL
                            THEN traffic_events.direction ELSE EXCLUDED.direction END,
           direction_checked = CASE WHEN traffic_events.version = EXCLUDED.version
                                    THEN traffic_events.direction_checked ELSE NULL END,
           version = EXCLUDED.version, category = EXCLUDED.category, situation_type = EXCLUDED.situation_type,
           secondary_types = EXCLUDED.secondary_types, severity = EXCLUDED.severity, title = EXCLUDED.title,
           description = EXCLUDED.description, road_numbers = EXCLUDED.road_numbers, geometry = EXCLUDED.geometry,
           reported_delay_min = EXCLUDED.reported_delay_min, start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time, active_periods = EXCLUDED.active_periods,
           source_updated_at = EXCLUDED.source_updated_at, last_seen_at = EXCLUDED.last_seen_at,
           status = 'present', gone_at = NULL, is_demo = EXCLUDED.is_demo`,
        [
          e.id, e.source, e.sourceId, e.version, e.category, e.situationType, JSON.stringify(e.secondaryTypes),
          e.severity, e.title, e.description, JSON.stringify(e.roadNumbers), JSON.stringify(e.lines), e.direction,
          e.reportedDelayMin, e.startTime, e.endTime,
          JSON.stringify(e.activePeriods.map(([s, x]) => [s.toISOString(), x.toISOString()])),
          e.sourceUpdatedAt, now, e.isDemo,
        ],
      );
    }
    await tx.query(
      `UPDATE traffic_events SET status = 'gone', gone_at = $3
       WHERE source = $1 AND status = 'present' AND NOT (id = ANY($2::text[]))`,
      [sourceId, snap.events.map((e) => e.id), now],
    );

    if (snap.travelTimes) {
      for (const t of snap.travelTimes) {
        await tx.query(
          `INSERT INTO travel_times (id, source, name, geometry, actual_sec, expected_sec, delay_sec, status_value,
             measured_at, last_seen_at, status, is_demo, kind, segment_id, segment_direction)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'present',$11,$12,$13,$14)
           ON CONFLICT (id) DO UPDATE SET name=$3, geometry=$4, actual_sec=$5, expected_sec=$6, delay_sec=$7,
             status_value=$8, measured_at=$9, last_seen_at=$10, status='present', is_demo=$11, kind=$12,
             segment_id=$13, segment_direction=$14`,
          [
            t.id, t.source, t.name, JSON.stringify(t.line), t.actualSec, t.expectedSec, t.delaySec,
            t.statusValue, t.measuredAt, now, t.isDemo, t.kind ?? "measured", t.segmentId ?? null,
            t.segmentDirection ?? null,
          ],
        );
      }
      if (snap.partialTravelTimes) {
        // Delvis oppdatering: bare det som ikke er spurt på en time, regnes som borte.
        await tx.query(
          `UPDATE travel_times SET status = 'gone'
           WHERE source = $1 AND status = 'present' AND last_seen_at < $2`,
          [sourceId, new Date(now.getTime() - 3600 * 1000)],
        );
      } else {
        await tx.query(
          `UPDATE travel_times SET status = 'gone'
           WHERE source = $1 AND status = 'present' AND NOT (id = ANY($2::text[]))`,
          [sourceId, snap.travelTimes.map((t) => t.id)],
        );
      }
    }
  });
}

export async function purgeOldData(db: Db, now: Date): Promise<void> {
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const quarterAgo = new Date(now.getTime() - 90 * 24 * 3600 * 1000);
  await db.query("DELETE FROM traffic_events WHERE status = 'gone' AND gone_at < $1", [weekAgo]);
  await db.query("DELETE FROM travel_times WHERE status = 'gone' AND last_seen_at < $1", [weekAgo]);
  // Estimater fra Google lagres kortvarig (vilkårene begrenser mellomlagring).
  await db.query("DELETE FROM travel_times WHERE kind = 'estimated' AND last_seen_at < $1", [
    new Date(now.getTime() - 24 * 3600 * 1000),
  ]);
  await db.query("DELETE FROM notifications WHERE created_at < $1", [quarterAgo]);
  await db.query("DELETE FROM poll_runs WHERE started_at < $1", [weekAgo]);
}

interface EventDbRow {
  id: string;
  source: string;
  source_id: string;
  version: string;
  category: Category;
  situation_type: string | null;
  secondary_types: string[];
  severity: number;
  title: string;
  description: string;
  road_numbers: string[];
  geometry: LonLat[][];
  direction: EventDirection;
  direction_checked: string | null;
  reported_delay_min: number | null;
  start_time: Date | null;
  end_time: Date | null;
  active_periods: Array<[string, string]>;
  source_updated_at: Date | null;
  is_demo: boolean;
}

export interface StoredEvent extends TrafficEvent {
  directionChecked: boolean;
}

export async function loadPresentEvents(db: Db): Promise<StoredEvent[]> {
  const rows = await db.query<EventDbRow>("SELECT * FROM traffic_events WHERE status = 'present'");
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    sourceId: r.source_id,
    version: r.version,
    category: r.category,
    situationType: r.situation_type,
    secondaryTypes: r.secondary_types,
    severity: r.severity,
    title: r.title,
    description: r.description,
    roadNumbers: r.road_numbers,
    lines: r.geometry,
    direction: r.direction,
    directionChecked: r.direction_checked === r.version,
    reportedDelayMin: r.reported_delay_min,
    startTime: r.start_time,
    endTime: r.end_time,
    activePeriods: r.active_periods.map(([s, e]) => [new Date(s), new Date(e)] as [Date, Date]),
    sourceUpdatedAt: r.source_updated_at,
    isDemo: r.is_demo,
  }));
}

export async function saveDirection(db: Db, eventId: string, version: string, direction: EventDirection): Promise<void> {
  await db.query(
    "UPDATE traffic_events SET direction = $3, direction_checked = $2 WHERE id = $1 AND version = $2",
    [eventId, version, direction],
  );
}

export async function loadPresentTravelTimes(db: Db): Promise<TravelTime[]> {
  const rows = await db.query<{
    id: string;
    source: string;
    name: string;
    geometry: LonLat[];
    actual_sec: number | null;
    expected_sec: number | null;
    delay_sec: number | null;
    status_value: string | null;
    measured_at: Date | null;
    is_demo: boolean;
    kind: "measured" | "estimated";
    segment_id: string | null;
    segment_direction: "same" | "opposite" | null;
  }>("SELECT * FROM travel_times WHERE status = 'present'");
  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    name: r.name,
    line: r.geometry,
    actualSec: r.actual_sec,
    expectedSec: r.expected_sec,
    delaySec: r.delay_sec,
    statusValue: r.status_value,
    measuredAt: r.measured_at,
    isDemo: r.is_demo,
    kind: r.kind,
    segmentId: r.segment_id,
    segmentDirection: r.segment_direction,
  }));
}

// ---------- Bruk av betalte API-er ----------

export async function recordApiUsage(db: Db, source: string, day: string, calls: number): Promise<void> {
  await db.query(
    `INSERT INTO api_usage (day, source, calls) VALUES ($1, $2, $3)
     ON CONFLICT (day, source) DO UPDATE SET calls = api_usage.calls + $3`,
    [day, source, calls],
  );
}

/** Sum av kall der dagen starter med prefikset ("2026-10-16" for dag, "2026-10" for måned). */
export async function apiUsage(db: Db, source: string, dayPrefix: string): Promise<number> {
  const rows = await db.query<{ n: number }>(
    "SELECT COALESCE(SUM(calls), 0)::int AS n FROM api_usage WHERE source = $1 AND day LIKE $2",
    [source, `${dayPrefix}%`],
  );
  return rows[0]?.n ?? 0;
}

// ---------- Kildestatus ----------

export async function recordSourceSuccess(
  db: Db,
  source: string,
  isDemo: boolean,
  at: Date,
  itemCount: number,
  durationMs: number,
): Promise<void> {
  await db.query(
    `INSERT INTO source_status (source, last_attempt_at, last_success_at, consecutive_failures, last_item_count, last_duration_ms, is_demo)
     VALUES ($1, $2, $2, 0, $3, $4, $5)
     ON CONFLICT (source) DO UPDATE SET last_attempt_at=$2, last_success_at=$2, consecutive_failures=0,
       last_item_count=$3, last_duration_ms=$4, is_demo=$5`,
    [source, at, itemCount, durationMs, isDemo],
  );
}

export async function recordSourceFailure(db: Db, source: string, isDemo: boolean, at: Date, error: string): Promise<void> {
  await db.query(
    `INSERT INTO source_status (source, last_attempt_at, last_error, last_error_at, consecutive_failures, is_demo)
     VALUES ($1, $2, $3, $2, 1, $4)
     ON CONFLICT (source) DO UPDATE SET last_attempt_at=$2, last_error=$3, last_error_at=$2,
       consecutive_failures = source_status.consecutive_failures + 1, is_demo=$4`,
    [source, at, error.slice(0, 500), isDemo],
  );
}

export async function getSourceStatuses(db: Db): Promise<SourceStatusRow[]> {
  const rows = await db.query<{
    source: string;
    last_attempt_at: Date | null;
    last_success_at: Date | null;
    last_error: string | null;
    last_error_at: Date | null;
    consecutive_failures: number;
    last_item_count: number | null;
    is_demo: boolean;
  }>("SELECT * FROM source_status ORDER BY source");
  return rows.map((r) => ({
    source: r.source,
    lastAttemptAt: r.last_attempt_at,
    lastSuccessAt: r.last_success_at,
    lastError: r.last_error,
    lastErrorAt: r.last_error_at,
    consecutiveFailures: r.consecutive_failures,
    lastItemCount: r.last_item_count,
    isDemo: r.is_demo,
  }));
}

// ---------- Varslingstilstand og logg ----------

export async function loadAlertStates(db: Db, segmentId: string): Promise<AlertState[]> {
  const rows = await db.query<{
    item_key: string;
    source: string;
    notified: boolean;
    first_matched_at: Date;
    last_matched_at: Date;
    last_notified_at: Date | null;
    last_category: Category | null;
    last_severity: number | null;
    last_delay_min: number | null;
    last_fingerprint: string | null;
  }>("SELECT * FROM alert_state WHERE segment_id = $1", [segmentId]);
  return rows.map((r) => ({
    itemKey: r.item_key,
    source: r.source,
    notified: r.notified,
    firstMatchedAt: r.first_matched_at,
    lastMatchedAt: r.last_matched_at,
    lastNotifiedAt: r.last_notified_at,
    lastCategory: r.last_category,
    lastSeverity: r.last_severity,
    lastDelayMin: r.last_delay_min,
    lastFingerprint: r.last_fingerprint,
  }));
}

export async function applyAlertOutcome(db: Db, segmentId: string, outcome: AlertOutcome): Promise<void> {
  await db.transaction(async (tx) => {
    for (const s of outcome.upserts) {
      await tx.query(
        `INSERT INTO alert_state (segment_id, item_key, source, notified, first_matched_at, last_matched_at,
           last_notified_at, last_category, last_severity, last_delay_min, last_fingerprint)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (segment_id, item_key) DO UPDATE SET source=$3, notified=$4, first_matched_at=$5,
           last_matched_at=$6, last_notified_at=$7, last_category=$8, last_severity=$9, last_delay_min=$10,
           last_fingerprint=$11`,
        [
          segmentId, s.itemKey, s.source, s.notified, s.firstMatchedAt, s.lastMatchedAt, s.lastNotifiedAt,
          s.lastCategory, s.lastSeverity, s.lastDelayMin, s.lastFingerprint,
        ],
      );
    }
    if (outcome.deletes.length) {
      await tx.query("DELETE FROM alert_state WHERE segment_id = $1 AND item_key = ANY($2::text[])", [
        segmentId,
        outcome.deletes,
      ]);
    }
  });
}

export interface NotificationRow {
  id: string;
  segmentId: string | null;
  kind: string;
  channel: string;
  status: string;
  title: string;
  body: string;
  error: string | null;
  isDemo: boolean;
  createdAt: Date;
}

export async function insertNotification(
  db: Db,
  n: Omit<NotificationRow, "id" | "createdAt"> & { userId: string; itemKey: string | null },
): Promise<void> {
  await db.query(
    `INSERT INTO notifications (user_id, segment_id, item_key, kind, channel, status, title, body, error, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [n.userId, n.segmentId, n.itemKey, n.kind, n.channel, n.status, n.title, n.body, n.error, n.isDemo],
  );
}

export async function listNotifications(db: Db, userId: string, limit = 50): Promise<NotificationRow[]> {
  const rows = await db.query<{
    id: string;
    segment_id: string | null;
    kind: string;
    channel: string;
    status: string;
    title: string;
    body: string;
    error: string | null;
    is_demo: boolean;
    created_at: Date;
  }>("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2", [userId, limit]);
  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segment_id,
    kind: r.kind,
    channel: r.channel,
    status: r.status,
    title: r.title,
    body: r.body,
    error: r.error,
    isDemo: r.is_demo,
    createdAt: r.created_at,
  }));
}

export async function countSentSince(db: Db, userId: string, since: Date): Promise<number> {
  const rows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications
     WHERE user_id = $1 AND created_at >= $2 AND status IN ('sent', 'dry_run') AND kind <> 'test'`,
    [userId, since],
  );
  return rows[0]?.n ?? 0;
}

/** Tar en tidsbegrenset lås. Utløper av seg selv hvis prosessen dør. */
export async function tryAcquirePollLock(db: Db, now: Date, leaseSeconds: number): Promise<boolean> {
  const rows = await db.query(
    "UPDATE poll_lock SET locked_until = $1 WHERE id = 1 AND locked_until < $2 RETURNING id",
    [new Date(now.getTime() + leaseSeconds * 1000), now],
  );
  return rows.length > 0;
}

export async function releasePollLock(db: Db): Promise<void> {
  await db.query("UPDATE poll_lock SET locked_until = '1970-01-01T00:00:00Z' WHERE id = 1");
}

export async function startPollRun(db: Db, trigger: string): Promise<string> {
  const rows = await db.query<{ id: string }>("INSERT INTO poll_runs (trigger) VALUES ($1) RETURNING id", [trigger]);
  return rows[0]!.id;
}

export async function finishPollRun(db: Db, id: string, summary: unknown, error: string | null): Promise<void> {
  await db.query("UPDATE poll_runs SET finished_at = now(), summary = $2, error = $3 WHERE id = $1", [
    id,
    JSON.stringify(summary),
    error,
  ]);
}

export async function lastPollRun(db: Db): Promise<{ startedAt: Date; finishedAt: Date | null; error: string | null } | null> {
  const rows = await db.query<{ started_at: Date; finished_at: Date | null; error: string | null }>(
    "SELECT started_at, finished_at, error FROM poll_runs ORDER BY started_at DESC LIMIT 1",
  );
  const r = rows[0];
  return r ? { startedAt: r.started_at, finishedAt: r.finished_at, error: r.error } : null;
}
