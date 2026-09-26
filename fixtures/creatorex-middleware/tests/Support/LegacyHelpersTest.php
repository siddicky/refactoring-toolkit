<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Support;

use function CreatorEx\Support\creatorex_format_date;
use function CreatorEx\Support\creatorex_money_string;
use function CreatorEx\Support\creatorex_pluck;

use PHPUnit\Framework\TestCase;

final class LegacyHelpersTest extends TestCase
{
    public function testPluckIncludesNullsForMissingKeys(): void
    {
        $rows = [['id' => 1, 'name' => 'ada'], ['id' => 2]];

        $this->assertSame(['ada', null], creatorex_pluck($rows, 'name'));
    }

    public function testPluckHandlesNonArrayRows(): void
    {
        $this->assertSame([1, null, null], creatorex_pluck([['v' => 1], 'scalar', null], 'v'));
    }

    public function testPluckReadsObjectProperties(): void
    {
        $plain = new \stdClass();
        $plain->v = 4;

        $this->assertSame([4, 9], creatorex_pluck([$plain, (object) ['v' => 9]], 'v'));
    }

    public function testFormatDateHandlesUnixTimestamps(): void
    {
        $this->assertSame('2026-01-15 10:30', creatorex_format_date(1768473000));
    }

    public function testNumericTimezoneShiftsHours(): void
    {
        $this->assertSame('2026-01-15 12:30', creatorex_format_date(1768473000, 2));
        $this->assertSame('2026-01-15 08:30', creatorex_format_date(1768473000, -2));
    }

    public function testNamedTimezonesAreSilentlyIgnored(): void
    {
        // (int) 'Europe/Berlin' is 0, so the named zone never shifts output.
        // DST is not handled; true Berlin time in January would be 11:30.
        $this->assertSame('2026-01-15 10:30', creatorex_format_date('2026-01-15T10:30:00Z', 'Europe/Berlin'));
    }

    public function testMoneyStringRoundsViaSprintf(): void
    {
        $this->assertSame('12.99', creatorex_money_string('12.999'));
        $this->assertSame('7.00', creatorex_money_string(7));
    }
}
