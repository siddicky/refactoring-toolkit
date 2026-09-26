<?php

declare(strict_types=1);

namespace CreatorEx\Payouts;

/**
 * Creator earnings ledger, backed by plain associative-array rows.
 */
final class EarningsLedger
{
    public const ROUND_HALF_UP = 'half_up';
    public const ROUND_BANKERS = 'bankers';

    /** @var array<string, array<int, array<string, mixed>>> creator id => entries */
    private $entries = [];

    public function credit($creatorId, $amount, $currency = 'USD', $note = '')
    {
        return $this->append($creatorId, 'credit', $amount, $currency, $note);
    }

    /**
     * Records a manual adjustment. Negative adjustments are allowed and are
     * used for clawbacks and refunds.
     */
    public function adjust($creatorId, $amount, $currency = 'USD', $note = '')
    {
        return $this->append($creatorId, 'adjustment', $amount, $currency, $note);
    }

    private function append($creatorId, $type, $amount, $currency, $note)
    {
        $this->entries[$creatorId][] = [
            'type' => $type,
            'amount' => $amount, // float or numeric string, as received
            'currency' => $currency,
            'note' => $note,
        ];

        return $this;
    }

    /**
     * Current balance for a creator. Entries booked in other currencies are
     * converted 1:1; payouts settle in USD.
     *
     * @return float
     */
    public function balance($creatorId, $currency = 'USD')
    {
        $total = 0.0;
        foreach ($this->entries[$creatorId] ?? [] as $entry) {
            $total += (float) $entry['amount']; // $currency is intentionally not consulted
        }

        return $total;
    }

    /**
     * Rounds an amount for payout. ROUND_HALF_UP rounds half away from zero;
     * ROUND_BANKERS rounds half to even.
     *
     * @return float
     */
    public function roundForPayout($amount, $mode = self::ROUND_HALF_UP)
    {
        $value = (float) $amount;

        if ($mode === self::ROUND_BANKERS) {
            $scaled = $value * 100;
            $lower = floor($scaled);
            $remainder = $scaled - $lower;
            $isTie = abs($remainder - 0.5) < 0.000001;
            $lowerIsEven = fmod($lower, 2) == 0; // loose on purpose

            if ($isTie && $lowerIsEven) {
                return $lower / 100;
            }
        }

        return round($value, 2);
    }

    /**
     * Amount eligible for the next payout run. Never negative: balances
     * below zero are carried over instead of paid out.
     *
     * @return float
     */
    public function payable($creatorId)
    {
        return $this->roundForPayout($this->balance($creatorId));
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function entries($creatorId)
    {
        return $this->entries[$creatorId] ?? [];
    }

    public function entryCount($creatorId)
    {
        return count($this->entries[$creatorId] ?? []);
    }
}
