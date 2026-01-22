"use client";

import { useEffect, useState } from "react";

const questions = [
  "How many brands are actually on Page 1?",
  "Can I realistically differentiate here?",
  "What's the real review barrier?",
  "Is demand concentrated or spread out?",
  "Is one brand dominating this market?",
  "What does this market look like without ads?",
  "Is this worth launching — or a trap?",
];

export default function TypewriterText() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    const currentQuestion = questions[currentQuestionIndex];
    let charIndex = 0;
    setIsTyping(true);
    setDisplayedText("");

    const typeInterval = setInterval(() => {
      if (charIndex < currentQuestion.length) {
        setDisplayedText(currentQuestion.slice(0, charIndex + 1));
        charIndex++;
      } else {
        setIsTyping(false);
        clearInterval(typeInterval);

        // After a short pause, move to next question
        setTimeout(() => {
          setDisplayedText("");
          setTimeout(() => {
            setCurrentQuestionIndex((prev) => (prev + 1) % questions.length);
          }, 300);
        }, 2000);
      }
    }, 50); // Natural typing speed

    return () => clearInterval(typeInterval);
  }, [currentQuestionIndex]);

  return (
    <p className="text-lg md:text-xl text-muted-foreground tracking-tight text-center">
      {displayedText}
      {isTyping && <span className="cursor-blink ml-1">|</span>}
    </p>
  );
}

