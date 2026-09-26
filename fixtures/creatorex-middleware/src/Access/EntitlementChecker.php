<?php

declare(strict_types=1);

namespace CreatorEx\Access;

/**
 * Paywall decision point: composes entitlement, age (18+), and geo gates for
 * a video view.
 *
 * Gates are registered with fluent require* calls (resolved by __call) and
 * evaluated against the raw session row.
 */
final class EntitlementChecker
{
    /**
     * Legacy numeric ISO codes stay allowed next to alpha-2 codes.
     */
    public const ALLOWED_GEOS = ['US', 'GB', 'DE', '840', '826'];

    /** @var array<string, mixed> */
    private $gates = [];

    /** @var array<string, array<string, mixed>> */
    private $entitlements;

    public function __construct(array $entitlements = [])
    {
        $this->entitlements = $entitlements;
    }

    /**
     * Fluent gate registration: requireAge(18), requireGeo('US'), and
     * requireEntitlement(true) all resolve here.
     */
    public function __call($name, $arguments)
    {
        if (strpos($name, 'require') === 0) {
            $this->gates[strtolower(substr($name, 7))] = $arguments[0] ?? true;

            return $this;
        }

        throw new \BadMethodCallException(sprintf('Unknown gate: %s', $name));
    }

    public function resetGates()
    {
        $this->gates = [];
    }

    /**
     * Decides whether the session may watch $content.
     *
     * @param array<string, mixed> $session
     *
     * @return array{allowed: bool, reasons: array<int, string>}
     */
    public function decide($session, $content = [])
    {
        $reasons = [];

        if (isset($this->gates['age'])) {
            $age = $session['age'] ?? null;
            if ($age === null || (float) $age < (float) $this->gates['age']) {
                $reasons[] = 'age';
            }
        }

        if (isset($this->gates['geo'])) {
            $geo = $session['geo'] ?? '';
            // Loose lookup on purpose: int 840 resolves via the legacy alias.
            // The requireGeo() argument itself is ignored.
            if (!in_array($geo, self::ALLOWED_GEOS)) {
                $reasons[] = 'geo';
            }
        }

        if ($this->gates['entitlement'] ?? false) {
            $entitled = $session['entitled'] ?? $this->lookupEntitlement($session);
            if (!$entitled) {
                $reasons[] = 'entitlement';
            }
        }

        return ['allowed' => $reasons === [], 'reasons' => $reasons];
    }

    private function lookupEntitlement($session)
    {
        $row = $this->entitlements[$session['user_id']] ?? null;
        if ($row === null) {
            return false;
        }

        return $row['video_pass'] ?? false;
    }
}
