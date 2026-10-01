<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Access;

use CreatorEx\Access\EntitlementChecker;
use PHPUnit\Framework\TestCase;

final class EntitlementCheckerTest extends TestCase
{
    private function checker(): EntitlementChecker
    {
        return (new EntitlementChecker([42 => ['video_pass' => true]]))
            ->requireAge(18)
            ->requireGeo('US')
            ->requireEntitlement(true);
    }

    private function session(): array
    {
        return ['user_id' => 42, 'age' => 21, 'geo' => 'US', 'entitled' => null];
    }

    public function testCleanSessionPassesAllGates(): void
    {
        $decision = $this->checker()->decide($this->session());

        $this->assertTrue($decision['allowed']);
        $this->assertSame([], $decision['reasons']);
    }

    public function testIntGeoResolvesLegacyNumericAlias(): void
    {
        $checker = (new EntitlementChecker())->requireGeo('US');

        $this->assertTrue($checker->decide(['geo' => 840])['allowed']);
        $this->assertTrue($checker->decide(['geo' => '840'])['allowed']);
    }

    public function testGeoLookupIsCaseSensitive(): void
    {
        $decision = (new EntitlementChecker())->requireGeo('US')->decide(['geo' => 'us']);

        $this->assertFalse($decision['allowed']);
        $this->assertSame(['geo'], $decision['reasons']);
    }

    public function testAgeGateCoercesStringAges(): void
    {
        $checker = (new EntitlementChecker())->requireAge(18);

        $this->assertTrue($checker->decide(['age' => 18])['allowed']);
        $this->assertTrue($checker->decide(['age' => '21'])['allowed']);
        $this->assertFalse($checker->decide(['age' => '17'])['allowed']);
    }

    public function testMissingAgeDeniesWhenGateIsSet(): void
    {
        $checker = (new EntitlementChecker())->requireAge(18);

        $this->assertFalse($checker->decide([])['allowed']);
        $this->assertFalse($checker->decide(['age' => null])['allowed']);
    }

    public function testStringZeroEntitlementDeniesDespiteLookup(): void
    {
        // '0' is falsy but not null, so it short-circuits the ?? lookup even
        // though user 42 holds a video_pass. The session satisfies the age and
        // geo gates, so the entitlement gate is the only reason to deny.
        $decision = $this->checker()->decide(array_merge($this->session(), ['entitled' => '0']));

        $this->assertFalse($decision['allowed']);
        $this->assertSame(['entitlement'], $decision['reasons']);
    }

    public function testNullEntitlementFallsThroughToLookup(): void
    {
        // A null 'entitled' falls through ?? to the stored video_pass lookup.
        $session = array_merge($this->session(), ['entitled' => null]);

        $this->assertTrue($this->checker()->decide($session)['allowed']);

        // A user with no stored entitlement row is denied by the same lookup.
        $denied = $this->checker()->decide(array_merge($session, ['user_id' => 99]));

        $this->assertFalse($denied['allowed']);
        $this->assertSame(['entitlement'], $denied['reasons']);
    }

    public function testEntitlementGateValueFalseDisablesTheCheck(): void
    {
        $checker = (new EntitlementChecker())->requireEntitlement(false);

        $this->assertTrue($checker->decide([])['allowed']);
    }

    public function testUnknownGateMethodThrows(): void
    {
        // __call only throws for names that do not start with "require".
        $this->expectException(\BadMethodCallException::class);

        $this->checker()->forbidMinors();
    }

    public function testUnknownRequireGateIsRegisteredButNeverEvaluated(): void
    {
        // A require* name outside age/geo/entitlement does not throw: __call
        // stores it as a gate and decide() never looks at it.
        $checker = (new EntitlementChecker())->requireFriendInvite();

        $this->assertInstanceOf(EntitlementChecker::class, $checker);
        $this->assertTrue($checker->decide([])['allowed']);
    }

    public function testGatesPersistAcrossDecisionsUntilReset(): void
    {
        $checker = $this->checker();

        $this->assertTrue($checker->decide($this->session())['allowed']);
        $this->assertFalse($checker->decide(['user_id' => 42, 'age' => 16, 'geo' => 'US'])['allowed']);

        $checker->resetGates();
        $this->assertTrue($checker->decide(['user_id' => 42])['allowed']);
    }
}
