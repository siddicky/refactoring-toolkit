<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Payouts;

use CreatorEx\Payouts\EarningsLedger;
use PHPUnit\Framework\TestCase;

final class EarningsLedgerTest extends TestCase
{
    public function testHalfUpRoundsAwayFromZero(): void
    {
        $ledger = new EarningsLedger();

        $this->assertSame(2.35, $ledger->roundForPayout(2.345));
        $this->assertSame(-2.35, $ledger->roundForPayout(-2.345));
    }

    public function testBankersRoundsHalfToEvenForPositiveTies(): void
    {
        $ledger = new EarningsLedger();

        $this->assertSame(2.34, $ledger->roundForPayout(2.345, EarningsLedger::ROUND_BANKERS));
        $this->assertSame(2.36, $ledger->roundForPayout(2.355, EarningsLedger::ROUND_BANKERS));
    }

    public function testBankersNeverChangesTheResultForNegativeTies(): void
    {
        $ledger = new EarningsLedger();

        // floor() moves away from zero for negatives, so the banker's branch
        // never changes the result there: an odd floor (-2.345) falls through
        // to round(), and an even floor (-2.355) takes the tie branch but
        // returns the same half-away-from-zero value.
        $this->assertSame(-2.35, $ledger->roundForPayout(-2.345, EarningsLedger::ROUND_BANKERS));
        $this->assertSame(-2.36, $ledger->roundForPayout(-2.355, EarningsLedger::ROUND_BANKERS));
    }

    public function testBalanceMixesCurrenciesOneToOne(): void
    {
        $ledger = new EarningsLedger();
        $ledger->credit(9, '10.00', 'USD', 'tips');
        $ledger->credit(9, '5.00', 'EUR', 'eu tips');

        // EUR entries are summed as if they were USD.
        $this->assertEqualsWithDelta(15.0, $ledger->balance(9), 0.0001);
        $this->assertEqualsWithDelta(15.0, $ledger->balance(9, 'EUR'), 0.0001);
    }

    public function testPayableIsNegativeDespiteDocblock(): void
    {
        $ledger = new EarningsLedger();
        $ledger->credit(9, '10.00');
        $ledger->adjust(9, '-12.50', 'USD', 'clawback');

        $this->assertSame(-2.5, $ledger->payable(9));
    }

    public function testEntriesKeepRawAmountTypes(): void
    {
        $ledger = new EarningsLedger();
        $ledger->credit(9, '10.00');
        $ledger->credit(9, 2.5);

        $entries = $ledger->entries(9);

        $this->assertSame('10.00', $entries[0]['amount']);
        $this->assertSame(2.5, $entries[1]['amount']);
        $this->assertSame(2, $ledger->entryCount(9));
    }
}
