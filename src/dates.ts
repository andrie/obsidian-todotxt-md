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
