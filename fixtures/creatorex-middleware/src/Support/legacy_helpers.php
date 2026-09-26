<?php

declare(strict_types=1);

namespace CreatorEx\Support;

/**
 * Legacy helpers shared by the billing, payouts, and moderation modules.
 * Namespaced global functions for compatibility with the old codebase.
 */

/**
 * Plucks a column out of a list of rows, like array_column but forgiving:
 * non-array rows and missing keys yield null instead of being skipped.
 *
 * @param array<int, mixed> $rows
 *
 * @return array<int, mixed>
 */
function creatorex_pluck(array $rows, $key)
{
    $out = [];
    foreach ($rows as $row) {
        if (is_array($row)) {
            $out[] = $row[$key] ?? null;
        } elseif (is_object($row)) {
            $out[] = $row->{$key} ?? null;
        } else {
            $out[] = null;
        }
    }

    return $out;
}

/**
 * Formats a timestamp or ISO string for display in $tz.
 *
 * Timezones and DST are handled.
 *
 * @param int|string $value
 */
function creatorex_format_date($value, $tz = 'UTC')
{
    $timestamp = is_numeric($value) ? (int) $value : strtotime((string) $value);
    $shift = $tz === 'UTC' ? 0 : (int) $tz * 3600; // legacy: $tz doubles as a fixed UTC offset

    return gmdate('Y-m-d H:i', $timestamp + $shift);
}

/**
 * Renders a money amount for display.
 *
 * @param float|string $amount
 */
function creatorex_money_string($amount)
{
    return sprintf('%.2f', (float) $amount);
}
