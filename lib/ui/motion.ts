/**
 * Sellerev Motion System
 * 
 * ⚠️ LAUNCH-CRITICAL: Motion tokens are FROZEN for launch.
 * 
 * This file defines the ONLY allowed motion primitives for Sellerev v1:
 * - fadeIn
 * - slideUp
 * - hoverElevation
 * - defaultTransition
 * 
 * RULES:
 * - No new animations may be added without explicit approval
 * - No per-component easing overrides
 * - No timing overrides
 * - All motion must use these tokens exclusively
 * 
 * Usage:
 *   import { fadeIn, slideUp, hoverElevation } from '@/lib/ui/motion';
 *   
 *   <motion.div variants={fadeIn} initial="initial" animate="animate">
 *     Content
 *   </motion.div>
 */

import { Variants, Transition } from 'framer-motion';

/**
 * Default transition configuration
 */
export const defaultTransition: Transition = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1], // ease-in-out cubic bezier
};

/**
 * Standard fade-in animation
 * Use for: Cards, content appearing on page load
 */
export const fadeIn: Variants = {
  initial: {
    opacity: 0,
  },
  animate: {
    opacity: 1,
    transition: defaultTransition,
  },
};

/**
 * Standard slide-up animation
 * Use for: Cards, sections appearing on scroll
 */
export const slideUp: Variants = {
  initial: {
    opacity: 0,
    y: 20,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: defaultTransition,
  },
};

/**
 * Standard hover elevation animation
 * Use for: Interactive cards, buttons on hover
 * 
 * Note: Combine with Tailwind shadow classes for full effect:
 *   className="shadow-sm" + hoverElevation variant
 */
export const hoverElevation: Variants = {
  initial: {
    scale: 1,
    y: 0,
  },
  hover: {
    scale: 1.01,
    y: -2,
    transition: defaultTransition,
  },
};

/**
 * Motion tokens export
 * 
 * Available tokens:
 * - defaultTransition: Base transition config (duration: 0.2s, ease-in-out)
 * - fadeIn: Fade in from opacity 0 to 1
 * - slideUp: Slide up 20px with fade in
 * - hoverElevation: Scale + shadow elevation on hover
 */
export const motionTokens = {
  defaultTransition,
  fadeIn,
  slideUp,
  hoverElevation,
} as const;

