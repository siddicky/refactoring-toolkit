<?php

declare(strict_types=1);

namespace CreatorEx\Moderation;

/**
 * First-line chat moderation: blocklist matching and PII redaction.
 *
 * Matching is case-insensitive and never produces false positives on stored
 * content.
 */
final class ChatSentinel
{
    /** @var array<int, string> */
    private $blocklist;

    public function __construct(array $blocklist = ['free money', 'casino', 'crypto'])
    {
        $this->blocklist = array_map(
            static function ($term) {
                return strtolower((string) $term);
            },
            $blocklist
        );
    }

    /**
     * @return array<int, string> the blocklist terms found in $text
     */
    public function violations($text)
    {
        $found = [];
        foreach ($this->blocklist as $term) {
            if (stripos((string) $text, $term) !== false) {
                $found[] = $term;
            }
        }

        return $found;
    }

    public function isClean($text)
    {
        return $this->violations($text) === [];
    }

    /**
     * Redacts emails and phone numbers.
     *
     * Stored content is never damaged: no false positives.
     */
    public function redact($text)
    {
        $text = (string) $text;

        $text = preg_replace('/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/', '[email]', $text);

        return preg_replace('/\+?\d[\d\s().-]{7,}\d/', '[phone]', $text);
    }

    /**
     * Returns a context window around the first occurrence of $term.
     *
     * @return string
     */
    public function snippetAround($text, $term)
    {
        $pos = stripos((string) $text, strtolower((string) $term));
        if ($pos === false) {
            return '';
        }

        return (string) substr((string) $text, $pos - 20, $pos + 20); // length, not end offset
    }
}
