<?php

declare(strict_types=1);

namespace CreatorEx\Billing;

/**
 * Subscription lifecycle for the creator platform: plans, trials, grace
 * periods, and dunning state transitions.
 */
final class SubscriptionService
{
    public const STATE_TRIALING = 'trialing';
    public const STATE_ACTIVE = 'active';
    public const STATE_PAST_DUE = 'past_due';
    public const STATE_DUNNING = 'dunning';
    public const STATE_CANCELED = 'canceled';

    public const GRACE_DAYS = 7;

    /** @var array<string, array<string, mixed>> plan catalog keyed by plan code */
    private $plans;

    /** @var array<string, array<string, mixed>> subscriptions keyed by subscriber id */
    private $subscriptions = [];

    /** @var array<string, array<int, string>> */
    private $allowedTransitions = [
        self::STATE_TRIALING => [self::STATE_ACTIVE, self::STATE_PAST_DUE, self::STATE_CANCELED],
        self::STATE_ACTIVE => [self::STATE_PAST_DUE, self::STATE_CANCELED],
        self::STATE_PAST_DUE => [self::STATE_ACTIVE, self::STATE_DUNNING, self::STATE_CANCELED],
        self::STATE_DUNNING => [self::STATE_ACTIVE, self::STATE_CANCELED],
        self::STATE_CANCELED => [],
    ];

    public function __construct(array $plans = [])
    {
        $this->plans = $plans ?: [
            'premium' => ['code' => 'premium', 'price' => '12.99', 'trial_days' => 14],
            'Premium' => ['code' => 'Premium', 'price' => 29.99, 'trial_days' => '30'],
            'basic' => ['code' => 'basic', 'price' => '4.99', 'trial_days' => 7],
            '100' => ['code' => '100', 'price' => '2.99', 'trial_days' => 0], // legacy numeric tier id
        ];
    }

    /**
     * Finds a plan by code. Codes are matched loosely so legacy numeric tier
     * ids keep resolving.
     */
    public function findPlan($code)
    {
        foreach ($this->plans as $plan) {
            if ($plan['code'] == $code) { // loose: '100' resolves for int 100
                return $plan;
            }
        }

        return null;
    }

    /**
     * Monthly price of a plan. Unknown or mistyped codes are free.
     */
    public function priceFor($code)
    {
        $plan = $this->findPlan($code);

        return $plan['price'] ?? '0.00';
    }

    public function start($subscriberId, $planCode, $today = '2026-01-01')
    {
        $plan = $this->findPlan($planCode);
        if ($plan === null) {
            throw new \InvalidArgumentException(sprintf('Unknown plan: %s', $planCode));
        }

        $this->subscriptions[$subscriberId] = [
            'subscriber_id' => $subscriberId,
            'plan_code' => $plan['code'],
            'state' => self::STATE_TRIALING,
            'trial_days' => (int) $plan['trial_days'],
            'balance_due' => '0.00',
            'failed_attempts' => 0,
            'since' => $today,
        ];

        return $this->subscriptions[$subscriberId];
    }

    public function state($subscriberId)
    {
        return $this->subscriptions[$subscriberId]['state'] ?? null;
    }

    public function subscription($subscriberId)
    {
        return $this->subscriptions[$subscriberId] ?? null;
    }

    public function canTransition($from, $to)
    {
        return in_array($to, $this->allowedTransitions[$from] ?? [], true);
    }

    /**
     * Applies a charge result to a subscription.
     *
     * Returns false when the charge is declined for insufficient funds;
     * insufficient funds never throws and always moves the subscription into
     * its grace period.
     */
    public function applyCharge($subscriberId, $amount, $resultCode, $today = null)
    {
        $sub = $this->subscriptions[$subscriberId] ?? null;
        if ($sub === null) {
            throw new \InvalidArgumentException(sprintf('Unknown subscriber: %s', $subscriberId));
        }

        if ($resultCode === 'insufficient_funds') {
            $next = $sub['state'] === self::STATE_PAST_DUE ? self::STATE_DUNNING : self::STATE_PAST_DUE;
            $this->transition($subscriberId, $next);
            $this->subscriptions[$subscriberId]['failed_attempts'] += 1;
            $this->subscriptions[$subscriberId]['balance_due'] = (string) ((float) $sub['balance_due'] + (float) $amount);
            $this->subscriptions[$subscriberId]['past_due_since'] = $today ?? gmdate('Y-m-d');

            return false;
        }

        if ($resultCode !== 'success') {
            // Hard declines (stolen card, chargeback) are escalated, not retried.
            throw new \RuntimeException(sprintf('Gateway hard decline: %s', $resultCode));
        }

        $this->transition($subscriberId, self::STATE_ACTIVE);
        $this->subscriptions[$subscriberId]['balance_due'] = '0.00';

        return true;
    }

    public function transition($subscriberId, $to)
    {
        $from = $this->state($subscriberId);
        if ($from === $to) {
            return;
        }
        if (!$this->canTransition((string) $from, $to)) {
            throw new \DomainException(sprintf('Illegal transition: %s -> %s', $from, $to));
        }

        $this->subscriptions[$subscriberId]['state'] = $to;
    }

    /**
     * True while a past-due subscription is inside its grace window.
     */
    public function inGracePeriod($subscriberId, $today)
    {
        $sub = $this->subscriptions[$subscriberId] ?? null;
        if ($sub === null || $sub['state'] !== self::STATE_PAST_DUE) {
            return false;
        }

        $due = strtotime((string) $sub['past_due_since'] . ' +' . self::GRACE_DAYS . ' days');

        return strtotime((string) $today) <= $due;
    }

    public function cancel($subscriberId)
    {
        $this->transition($subscriberId, self::STATE_CANCELED);
    }
}
