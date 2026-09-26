<?php

declare(strict_types=1);

namespace CreatorEx\Tests\Billing;

use CreatorEx\Billing\SubscriptionService;
use PHPUnit\Framework\TestCase;

final class SubscriptionServiceTest extends TestCase
{
    private function service(): SubscriptionService
    {
        $service = new SubscriptionService();
        $service->start(7, 'premium', '2026-01-01');

        return $service;
    }

    public function testStartBeginsTrialingState(): void
    {
        $service = new SubscriptionService();
        $sub = $service->start(7, 'premium', '2026-01-01');

        $this->assertSame(SubscriptionService::STATE_TRIALING, $sub['state']);
        $this->assertSame(14, $sub['trial_days']);

        $this->assertTrue($service->applyCharge(7, '12.99', 'success', '2026-01-15'));
        $this->assertSame(SubscriptionService::STATE_ACTIVE, $service->state(7));
    }

    public function testUnknownPlanThrowsOnStart(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        (new SubscriptionService())->start(7, 'pro', '2026-01-01');
    }

    public function testPlanCodesAreCaseSensitive(): void
    {
        $service = new SubscriptionService();

        $this->assertSame('12.99', $service->findPlan('premium')['price']);
        $this->assertSame(29.99, $service->findPlan('Premium')['price']);
        $this->assertNull($service->findPlan('PREMIUM'));
    }

    public function testLooseMatchResolvesLegacyNumericTier(): void
    {
        $service = new SubscriptionService();

        $this->assertSame('100', $service->findPlan(100)['code']);
        $this->assertSame('2.99', $service->priceFor(100));
    }

    public function testMistypedCodesFallBackToFreePricing(): void
    {
        $service = new SubscriptionService();

        // 'PREMIUM' misses the catalog, and ?? substitutes the free price.
        $this->assertSame('0.00', $service->priceFor('PREMIUM'));
    }

    public function testPlanPricesMixStringsAndFloats(): void
    {
        $service = new SubscriptionService();

        $this->assertSame('12.99', $service->priceFor('premium')); // string
        $this->assertSame(29.99, $service->priceFor('Premium')); // float
    }

    public function testSoftDeclineMovesIntoGrace(): void
    {
        $service = $this->service();

        $this->assertFalse($service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02'));
        $this->assertSame(SubscriptionService::STATE_PAST_DUE, $service->state(7));
        $this->assertSame('12.99', $service->subscription(7)['balance_due']);
    }

    public function testSoftDeclinesWalkGraceThenDunning(): void
    {
        $service = $this->service();

        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-09');

        $this->assertSame(SubscriptionService::STATE_DUNNING, $service->state(7));
        $this->assertSame('25.98', $service->subscription(7)['balance_due']);
        $this->assertSame(2, $service->subscription(7)['failed_attempts']);
    }

    public function testHardDeclineThrowsDespiteDocblock(): void
    {
        $service = $this->service();

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Gateway hard decline');

        $service->applyCharge(7, '12.99', 'card_stolen', '2026-01-02');
    }

    public function testGraceWindowCoversSevenDays(): void
    {
        $service = $this->service();
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');

        $this->assertTrue($service->inGracePeriod(7, '2026-01-09'));
        $this->assertFalse($service->inGracePeriod(7, '2026-01-10'));
        // Dates before the grace start still pass: only an upper bound exists.
        $this->assertTrue($service->inGracePeriod(7, '2026-01-01'));
    }

    public function testSuccessReactivatesAndClearsBalance(): void
    {
        $service = $this->service();
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-09');

        $this->assertTrue($service->applyCharge(7, '25.98', 'success', '2026-01-12'));
        $this->assertSame(SubscriptionService::STATE_ACTIVE, $service->state(7));
        $this->assertSame('0.00', $service->subscription(7)['balance_due']);
    }

    public function testCancelFromDunningIsTerminal(): void
    {
        $service = $this->service();
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-02');
        $service->applyCharge(7, '12.99', 'insufficient_funds', '2026-01-09');
        $service->cancel(7);

        $this->assertSame(SubscriptionService::STATE_CANCELED, $service->state(7));
        $this->assertFalse($service->canTransition(SubscriptionService::STATE_CANCELED, SubscriptionService::STATE_ACTIVE));
    }
}
