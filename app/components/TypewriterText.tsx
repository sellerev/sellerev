"use client";

import { useEffect, useState, useRef } from "react";
import { motion, useAnimationControls } from "framer-motion";

const questions = [
  "Is this market enterable for a new seller?",
  "Is revenue concentrated among top sellers?",
  "Who would I fight for page-1 visibility?",
  "Price war or differentiation, which wins?",
  "Is demand spread out or carried by hero listings?",
  "What's the biggest structural risk here?",
  "Does the algorithm reward incumbents?",
  "Is organic traction realistic without PPC?",
  "Is this market fragile to price undercutting?",
  "Would this reward execution, or punish late entry?",
];

type Mode = "typing" | "pausing" | "deleting";

export default function TypewriterText() {
  const [questionIndex, setQuestionIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [mode, setMode] = useState<Mode>("typing");
  const caretControls = useAnimationControls();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const currentQuestion = questions[questionIndex];
    let charIndex = 0;

    const clearInterval = () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    // Start typing
    setMode("typing");
    setDisplayedText("");
    charIndex = 0;

    intervalRef.current = setInterval(() => {
      if (charIndex < currentQuestion.length) {
        setDisplayedText(currentQuestion.slice(0, charIndex + 1));
        charIndex++;
      } else {
        clearInterval();
        // Pause after typing complete
        setMode("pausing");
        setTimeout(() => {
          // Start deleting
          setMode("deleting");
          charIndex = currentQuestion.length;
          intervalRef.current = setInterval(() => {
            if (charIndex > 0) {
              charIndex--;
              setDisplayedText(currentQuestion.slice(0, charIndex));
            } else {
              clearInterval();
              setDisplayedText("");
              // Pause after deleting complete
              setMode("pausing");
              setTimeout(() => {
                // Move to next question
                setQuestionIndex((prev) => (prev + 1) % questions.length);
              }, 500);
            }
          }, 30); // Faster delete speed
        }, 1500); // Pause after typing
      }
    }, 50); // Typing speed

    return () => {
      clearInterval();
    };
  }, [questionIndex, caretControls]);

  // Animate caret blink continuously when visible
  useEffect(() => {
    if (mode === "typing" || mode === "deleting") {
      caretControls.start({
        opacity: [1, 1, 0, 0],
        transition: {
          duration: 1,
          repeat: Infinity,
          ease: "easeInOut",
        },
      });
    } else {
      caretControls.set({ opacity: 0 });
    }
  }, [mode, caretControls]);

  return (
    <div className="min-h-[28px] md:min-h-[32px] flex items-center justify-center">
      <p className="text-lg md:text-xl text-muted-foreground tracking-tight text-center whitespace-nowrap overflow-hidden">
        {displayedText}
        {mode !== "pausing" && (
          <motion.span
            animate={caretControls}
            initial={{ opacity: 1 }}
            className="ml-1 inline-block"
          >
            |
          </motion.span>
        )}
      </p>
    </div>
  );
}
