//! Share accounting math (pure functions, no NEAR environment).
//! Mirrors `contracts/vault/model/examples.cjs`; see docs/VAULT_V2.md §3.
//! All amounts are micro-USDC (6 decimals). Rounding always favours the vault.

/// Virtual shares and assets: make the empty-vault price well defined and the
/// classic first-depositor inflation attack unprofitable.
pub const VIRTUAL_SHARES: u128 = 1_000_000;
pub const VIRTUAL_ASSETS: u128 = 1;

fn mul_div_floor(a: u128, b: u128, d: u128) -> u128 {
    // u128 is enough: assets ≤ ~1e20 µ (1e14 USDC), shares ≤ assets·1e6 ≈ 1e26, product ≤ ~1e46 > u128::MAX (3.4e38).
    // So use 256-bit intermediate via splitting.
    mul_div(a, b, d, false)
}
fn mul_div_ceil(a: u128, b: u128, d: u128) -> u128 {
    mul_div(a, b, d, true)
}

/// (a·b)/d with a 256-bit intermediate. Panics on d == 0 or a result that overflows u128.
pub fn mul_div(a: u128, b: u128, d: u128, round_up: bool) -> u128 {
    assert!(d > 0, "division by zero");
    let (hi, lo) = mul_wide(a, b);
    let (q, r) = div_wide(hi, lo, d);
    if round_up && r > 0 {
        q.checked_add(1).expect("overflow")
    } else {
        q
    }
}

fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    let (a1, a0) = (a >> 64, a & u64::MAX as u128);
    let (b1, b0) = (b >> 64, b & u64::MAX as u128);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & u64::MAX as u128) + (p10 & u64::MAX as u128);
    let lo = (p00 & u64::MAX as u128) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

/// Divides the 256-bit number (hi, lo) by d; returns (quotient, remainder). Quotient must fit in u128.
fn div_wide(hi: u128, lo: u128, d: u128) -> (u128, u128) {
    assert!(hi < d, "overflow");
    if hi == 0 {
        return (lo / d, lo % d);
    }
    // bitwise long division (128 iterations; only used for very large values)
    let mut rem = hi;
    let mut q: u128 = 0;
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        if carry == 1 || rem >= d {
            rem = rem.wrapping_sub(d);
            q |= 1 << i;
        }
    }
    (q, rem)
}

/// Shares minted for a deposit of `assets` (floor).
pub fn shares_for_deposit(assets: u128, total_assets: u128, total_shares: u128) -> u128 {
    mul_div_floor(assets, total_shares + VIRTUAL_SHARES, total_assets + VIRTUAL_ASSETS)
}

/// Asset value of `shares` (floor).
pub fn assets_for_shares(shares: u128, total_assets: u128, total_shares: u128) -> u128 {
    mul_div_floor(shares, total_assets + VIRTUAL_ASSETS, total_shares + VIRTUAL_SHARES)
}

/// Shares that must be burned to take exactly `assets` out (ceil).
pub fn shares_to_burn(assets: u128, total_assets: u128, total_shares: u128) -> u128 {
    mul_div_ceil(assets, total_shares + VIRTUAL_SHARES, total_assets + VIRTUAL_ASSETS)
}

/// A user's position at the current price.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub value: u128,
    /// Only this can be donated.
    pub yield_amount: u128,
    /// Only this can be withdrawn by the user.
    pub withdrawable: u128,
}

pub fn position(shares: u128, principal: u128, total_assets: u128, total_shares: u128) -> Position {
    let value = assets_for_shares(shares, total_assets, total_shares);
    Position { value, yield_amount: value.saturating_sub(principal), withdrawable: value.min(principal) }
}

/// Principal basis removed when withdrawing `amount`.
/// In profit the basis falls by exactly `amount` (yield stays committed to charity);
/// in a loss it falls pro-rata so the user keeps bearing their share of the loss.
pub fn principal_reduction(amount: u128, principal: u128, value: u128) -> u128 {
    if value >= principal {
        amount.min(principal)
    } else if value == 0 {
        principal
    } else {
        mul_div_ceil(amount, principal, value).min(principal)
    }
}

/// Splits `total` by basis points (sum 10_000). Floors each part; the remainder goes to the
/// largest allocation (first on ties), so parts always sum exactly to `total`.
pub fn split_bps(total: u128, bps: &[u16]) -> Vec<u128> {
    let mut parts: Vec<u128> = bps.iter().map(|b| total * (*b as u128) / 10_000).collect();
    let used: u128 = parts.iter().sum();
    if let Some((i, _)) = bps.iter().enumerate().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(&a.0))) {
        parts[i] += total - used;
    }
    parts
}

#[cfg(test)]
mod tests {
    use super::*;
    const U: u128 = 1_000_000;

    /// Minimal model vault used to reproduce docs/VAULT_V2.md examples exactly.
    struct M {
        a: u128,
        s: u128,
        users: Vec<(u128, u128)>, // (shares, principal)
    }
    impl M {
        fn new(n: usize) -> Self {
            M { a: 0, s: 0, users: vec![(0, 0); n] }
        }
        fn deposit(&mut self, u: usize, x: u128) {
            let sh = shares_for_deposit(x, self.a, self.s);
            self.users[u].0 += sh;
            self.users[u].1 += x;
            self.s += sh;
            self.a += x;
        }
        fn pos(&self, u: usize) -> Position {
            position(self.users[u].0, self.users[u].1, self.a, self.s)
        }
        fn donate(&mut self, u: usize, x: u128) {
            assert!(x <= self.pos(u).yield_amount, "exceeds yield");
            let b = shares_to_burn(x, self.a, self.s).min(self.users[u].0);
            self.users[u].0 -= b;
            self.s -= b;
            self.a -= x;
        }
        fn withdraw(&mut self, u: usize, x: u128) {
            let p = self.pos(u);
            assert!(x <= p.withdrawable, "exceeds withdrawable");
            let b = shares_to_burn(x, self.a, self.s).min(self.users[u].0);
            let pr = principal_reduction(x, self.users[u].1, p.value);
            self.users[u].0 -= b;
            self.users[u].1 -= pr;
            self.s -= b;
            self.a -= x;
        }
        fn accrue(&mut self, bps: u128) {
            self.a += self.a * bps / 10_000;
        }
        fn lose(&mut self, bps: u128) {
            self.a -= self.a * bps / 10_000;
        }
        fn check(&self) {
            let ss: u128 = self.users.iter().map(|u| u.0).sum();
            assert_eq!(ss, self.s, "Σshares == S");
            let sv: u128 = (0..self.users.len()).map(|u| self.pos(u).value).sum();
            assert!(sv <= self.a, "Σvalue ≤ A");
        }
        fn pps(&self) -> (u128, u128) {
            (self.a + VIRTUAL_ASSETS, self.s + VIRTUAL_SHARES)
        }
    }
    // price comparison without division: a1/s1 >= a0/s0
    fn price_ge(n: (u128, u128), o: (u128, u128)) -> bool {
        mul_div(n.0, o.1, 1, false) >= mul_div(o.0, n.1, 1, false)
    }

    #[test]
    fn example_1_unequal_times() {
        let mut m = M::new(2);
        m.deposit(0, 1000 * U);
        assert_eq!(m.users[0].0, 1_000_000_000_000_000);
        m.accrue(1000);
        m.deposit(1, 1000 * U);
        assert_eq!(m.users[1].0, 909_090_909_173_553);
        m.accrue(500);
        assert_eq!(m.pos(0).value, 1_154_999_999);
        assert_eq!(m.pos(0).yield_amount, 154_999_999);
        assert_eq!(m.pos(1).value, 1_049_999_999);
        assert_eq!(m.pos(1).yield_amount, 49_999_999);
        m.check();
    }

    #[test]
    fn example_2_donation_does_not_touch_others() {
        let mut m = M::new(2);
        m.deposit(0, 1000 * U);
        m.accrue(1000);
        m.deposit(1, 1000 * U);
        m.accrue(500);
        let bob = m.pos(1).value;
        let before = m.pps();
        let y = m.pos(0).yield_amount;
        m.donate(0, y);
        assert_eq!(m.pos(1).value, bob);
        assert_eq!(m.pos(0).value, 1000 * U);
        assert!(price_ge(m.pps(), before), "price never falls on donation");
        m.check();
    }

    #[test]
    fn example_3_partial_withdraw_keeps_yield() {
        let mut m = M::new(2);
        m.deposit(0, 1000 * U);
        m.accrue(1000);
        m.deposit(1, 1000 * U);
        m.accrue(500);
        let y = m.pos(1).yield_amount;
        m.withdraw(1, 400 * U);
        assert_eq!(m.users[1].1, 600 * U);
        assert_eq!(m.pos(1).yield_amount, y);
        m.check();
    }

    #[test]
    fn example_4_loss() {
        let mut m = M::new(2);
        m.deposit(0, 1000 * U);
        m.accrue(1000);
        m.deposit(1, 1000 * U);
        m.accrue(500);
        let y = m.pos(0).yield_amount;
        m.donate(0, y);
        m.withdraw(1, 400 * U);
        m.lose(2000);
        assert_eq!(m.pos(0).yield_amount, 0);
        assert_eq!(m.pos(1).yield_amount, 0);
        assert_eq!(m.pos(0).withdrawable, 800 * U);
        assert_eq!(m.pos(1).withdrawable, 520 * U);
        let bob = m.pos(1).value;
        m.withdraw(0, 800 * U);
        assert_eq!(m.users[0].1, 0, "basis fully released");
        assert_eq!(m.pos(1).value, bob, "Bob unaffected by Alice's exit");
        m.check();
    }

    #[test]
    #[should_panic(expected = "exceeds yield")]
    fn cannot_donate_in_loss() {
        let mut m = M::new(1);
        m.deposit(0, 1000 * U);
        m.lose(100);
        m.donate(0, 1);
    }

    #[test]
    #[should_panic(expected = "exceeds withdrawable")]
    fn cannot_withdraw_yield() {
        let mut m = M::new(1);
        m.deposit(0, 1000 * U);
        m.accrue(1000);
        m.withdraw(0, 1000 * U + 1);
    }

    #[test]
    fn example_5_rounding_favours_vault() {
        let mut m = M::new(2);
        m.deposit(0, 3);
        m.accrue(3333);
        m.deposit(1, 7);
        let b = shares_to_burn(1, m.a, m.s);
        assert!(assets_for_shares(b, m.a, m.s) >= 1);
        m.check();
    }

    #[test]
    fn example_6_inflation_attack_unprofitable() {
        let mut m = M::new(2);
        m.deposit(0, 1);
        m.a += 1000 * U; // attacker inflates assets directly (impossible in the contract; assumed here)
        m.deposit(1, 999 * U);
        let victim = m.pos(1).value;
        assert!(victim >= 999 * U - 1_000, "victim loses at most dust: {}", victim);
        let attacker = m.pos(0).value;
        assert!(attacker < 1000 * U / 2 + 1_000, "attacker loses about half of what they pushed in");
    }

    #[test]
    fn many_random_ops_preserve_invariants() {
        // deterministic pseudo-random sequence of deposits, yield, donations, withdrawals and losses
        let mut seed: u64 = 42;
        let mut rnd = |n: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % n
        };
        let mut m = M::new(5);
        for _ in 0..3000 {
            let u = rnd(5) as usize;
            match rnd(6) {
                0 | 1 => m.deposit(u, (rnd(5000) as u128 + 1) * 1000),
                2 => m.accrue(rnd(50) as u128),
                3 => {
                    let y = m.pos(u).yield_amount;
                    if y > 0 {
                        let before = m.pps();
                        let others: Vec<u128> = (0..5).filter(|&o| o != u).map(|o| m.pos(o).value).collect();
                        m.donate(u, (y * (rnd(100) as u128 + 1)) / 100);
                        assert!(price_ge(m.pps(), before));
                        let after: Vec<u128> = (0..5).filter(|&o| o != u).map(|o| m.pos(o).value).collect();
                        for (a, b) in after.iter().zip(others.iter()) {
                            assert!(a >= b, "a donation reduced another user's value");
                        }
                    }
                }
                4 => {
                    let w = m.pos(u).withdrawable;
                    if w > 0 {
                        m.withdraw(u, (w * (rnd(100) as u128 + 1)) / 100);
                    }
                }
                _ => {
                    if rnd(20) == 0 {
                        m.lose(rnd(300) as u128)
                    }
                }
            }
            m.check();
        }
    }

    #[test]
    fn split_is_exact() {
        assert_eq!(split_bps(100, &[7000, 3000]), vec![70, 30]);
        assert_eq!(split_bps(101, &[3333, 3333, 3334]).iter().sum::<u128>(), 101);
        assert_eq!(split_bps(1, &[5000, 5000]).iter().sum::<u128>(), 1);
    }

    #[test]
    fn wide_math() {
        let big = 10u128.pow(30);
        assert_eq!(mul_div(big, big, big, false), big);
        assert_eq!(mul_div(7, 3, 2, true), 11);
        assert_eq!(mul_div(u128::MAX, 2, 4, false), u128::MAX / 2);
    }
}
