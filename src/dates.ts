/**
 * Human date-shortcut expansion. Input-only convenience — expanded results are ISO
 * YYYY-MM-DD and that's the only form ever persisted (DESIGN_RULES.md section 2.5).
 * Never calls `new Date()` directly for "today" — always takes an injected clock so
 * expansion is deterministic in tests (DESIGN_RULES.md section 3.2).
 */

export type Clock = () => Date;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function toIso(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
	const result = new Date(date.getTime());
	result.setDate(result.getDate() + days);
	return result;
}

const RELATIVE_RE = /^\+(\d+)([dw])$/;

/**
 * Expands a single date-shortcut token to an ISO date, or returns null if `token` isn't a
 * recognized shortcut (caller should leave unrecognized text untouched).
 */
export function expandDateToken(token: string, clock: Clock): string | null {
	const today = clock();
	const lower = token.toLowerCase();

	if (lower === "tod") {
		return toIso(today);
	}
	if (lower === "tom") {
		return toIso(addDays(today, 1));
	}

	const weekdayIndex = WEEKDAYS.indexOf(lower);
	if (weekdayIndex !== -1) {
		const todayIndex = today.getDay();
		let delta = weekdayIndex - todayIndex;
		if (delta <= 0) delta += 7;
		return toIso(addDays(today, delta));
	}

	const relativeMatch = RELATIVE_RE.exec(lower);
	if (relativeMatch) {
		const amount = Number(relativeMatch[1]);
		const unit = relativeMatch[2];
		const days = unit === "w" ? amount * 7 : amount;
		return toIso(addDays(today, days));
	}

	return null;
}

export interface DateShortcutSuggestion {
	/** The shortcut token as the user would type it, e.g. "tod", "mon", "+3d". */
	token: string;
	/** Resolved ISO date, e.g. "2026-09-20". Null only for the relative-offset pattern hint. */
	iso: string | null;
	/** Short human label shown alongside the date, e.g. "today", "next Monday". */
	label: string;
}

const WEEKDAY_LABELS: Record<string, string> = {
	sun: "Sunday",
	mon: "Monday",
	tue: "Tuesday",
	wed: "Wednesday",
	thu: "Thursday",
	fri: "Friday",
	sat: "Saturday",
};

/**
 * Enumerates date-shortcut suggestions whose token starts with `partial` (case-insensitive).
 * Used by the live-suggestion popup (dateSuggest.ts) to show multiple candidates as the user
 * types; distinct from expandDateToken, which resolves one *complete* token. Pure/deterministic
 * via the same injected clock. Returns [] for an unmatched partial — the caller decides whether
 * to show a popup at all (this function does not gate on "should a popup appear").
 */
export function suggestDateShortcuts(partial: string, clock: Clock): DateShortcutSuggestion[] {
	const lower = partial.toLowerCase();

	if (lower.startsWith("+")) {
		if (RELATIVE_RE.test(lower)) {
			const iso = expandDateToken(lower, clock);
			return iso ? [{ token: lower, iso, label: "relative offset" }] : [];
		}
		if (/^\+\d*$/.test(lower)) {
			return [{ token: "+Nd", iso: null, label: "relative offset, e.g. +3d or +1w" }];
		}
		return [];
	}

	const candidates: Array<{ token: string; label: string }> = [
		{ token: "tod", label: "today" },
		{ token: "tom", label: "tomorrow" },
		...WEEKDAYS.map((day) => ({ token: day, label: WEEKDAY_LABELS[day] })),
	];

	return candidates
		.filter((c) => c.token.startsWith(lower))
		.map((c) => ({ token: c.token, iso: expandDateToken(c.token, clock), label: c.label }));
}
