// Single source of truth for Buddy's availability across the whole site.
// While true: /ask-buddy shows the in-house-training placeholder and every
// "Talk to Buddy" entry point shows a quiet "in training" heads-up.
// Flip to false (and push) to restore the live chat everywhere at once.
export const BUDDY_IN_TRAINING = false;
