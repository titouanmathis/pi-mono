import { accessSync, constants } from "node:fs";
import * as os from "node:os";
import { isAbsolute, resolve as resolvePath } from "node:path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
const NARROW_NO_BREAK_SPACE = "\u202F";
function normalizeUnicodeSpaces(str: string): string {
	return str.replace(UNICODE_SPACES, " ");
}

function tryMacOSScreenshotPath(filePath: string): string {
	return filePath.replace(/ (AM|PM)\./g, `${NARROW_NO_BREAK_SPACE}$1.`);
}

/**
 * Try to match a path using macOS NFD normalization.
 * macOS HFS+ and APFS use NFD (decomposed) form for filenames,
 * but users often type NFC (composed) form.
 */
function tryMacOSNfdPath(filePath: string): string {
	// Convert to NFD (decomposed) form - what macOS uses
	return filePath.normalize("NFD");
}

/**
 * Try to match a path by replacing straight quotes with curly quotes.
 * macOS uses curly quotes (') in screenshot filenames like "Capture d'écran".
 */
function tryMacOSCurlyQuotePath(filePath: string): string {
	// Replace straight apostrophe (U+0027) with right single quotation mark (U+2019)
	return filePath.replace(/'/g, "\u2019");
}

function fileExists(filePath: string): boolean {
	try {
		accessSync(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

export function expandPath(filePath: string): string {
	const normalized = normalizeUnicodeSpaces(filePath);
	if (normalized === "~") {
		return os.homedir();
	}
	if (normalized.startsWith("~/")) {
		return os.homedir() + normalized.slice(1);
	}
	return normalized;
}

/**
 * Resolve a path relative to the given cwd.
 * Handles ~ expansion and absolute paths.
 */
export function resolveToCwd(filePath: string, cwd: string): string {
	const expanded = expandPath(filePath);
	if (isAbsolute(expanded)) {
		return expanded;
	}
	return resolvePath(cwd, expanded);
}

export function resolveReadPath(filePath: string, cwd: string): string {
	const resolved = resolveToCwd(filePath, cwd);

	if (fileExists(resolved)) {
		return resolved;
	}

	// Try macOS-specific path variants
	const variants = [
		// AM/PM with narrow no-break space
		tryMacOSScreenshotPath(resolved),
		// NFD normalization (macOS filesystem uses decomposed Unicode)
		tryMacOSNfdPath(resolved),
		// Curly quotes (macOS uses ' instead of ' in screenshot names)
		tryMacOSCurlyQuotePath(resolved),
		// Combination: NFD + curly quotes
		tryMacOSNfdPath(tryMacOSCurlyQuotePath(resolved)),
		// Combination: curly quotes + NFD (order might matter)
		tryMacOSCurlyQuotePath(tryMacOSNfdPath(resolved)),
	];

	for (const variant of variants) {
		if (variant !== resolved && fileExists(variant)) {
			return variant;
		}
	}

	return resolved;
}
