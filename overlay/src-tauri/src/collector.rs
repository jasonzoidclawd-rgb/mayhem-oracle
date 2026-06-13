pub const DAILY_EXPORT_LIMIT: u16 = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameflowPhase {
    None,
    InProgress,
}

#[derive(Clone, Copy, Debug)]
pub struct CollectionPolicy {
    pub consented: bool,
    pub paused: bool,
    pub exported_today: u16,
}

impl CollectionPolicy {
    pub fn may_collect(&self, _phase: GameflowPhase) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_collection_until_the_daily_limit() {
        let policy = CollectionPolicy {
            consented: true,
            paused: false,
            exported_today: DAILY_EXPORT_LIMIT - 1,
        };

        assert!(policy.may_collect(GameflowPhase::None));
    }

    #[test]
    fn rejects_collection_at_the_daily_limit() {
        let policy = CollectionPolicy {
            consented: true,
            paused: false,
            exported_today: DAILY_EXPORT_LIMIT,
        };

        assert!(!policy.may_collect(GameflowPhase::None));
    }

    #[test]
    fn pauses_collection_during_an_active_game() {
        let policy = CollectionPolicy {
            consented: true,
            paused: false,
            exported_today: 0,
        };

        assert!(!policy.may_collect(GameflowPhase::InProgress));
    }
}
