"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const questions = [
  "How many brands are actually on Page 1?",
  "Can I realistically differentiate here?",
  "What's the real review barrier?",
  "Is demand concentrated or spread out?",
  "Is one brand dominating this market?",
  "What does this market look like without ads?",
  "Is this worth launching — or a trap?",
];

const responses = [
  "Let's break it down.",
  "Here's what the market structure shows.",
  "This is more nuanced than it looks.",
  "There's opportunity here — but with tradeoffs.",
];

export default function AIChatVisual() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const [showResponse, setShowResponse] = useState(false);
  const [hoverText, setHoverText] = useState("");

  useEffect(() => {
    const currentQuestion = questions[currentQuestionIndex];
    let charIndex = 0;
    setIsTyping(true);
    setDisplayedText("");
    setShowResponse(false);

    const typeInterval = setInterval(() => {
      if (charIndex < currentQuestion.length) {
        setDisplayedText(currentQuestion.slice(0, charIndex + 1));
        charIndex++;
      } else {
        setIsTyping(false);
        clearInterval(typeInterval);

        // Show response after a brief pause
        setTimeout(() => {
          setShowResponse(true);
          setTimeout(() => {
            setShowResponse(false);
            // Move to next question
            setTimeout(() => {
              setCurrentQuestionIndex((prev) => (prev + 1) % questions.length);
            }, 500);
          }, 2000);
        }, 1500);
      }
    }, 50); // Natural typing speed

    return () => clearInterval(typeInterval);
  }, [currentQuestionIndex]);

  const currentResponse = responses[currentQuestionIndex % responses.length];

  return (
    <div
      className="glass-panel p-6 min-h-[200px] relative"
      onMouseEnter={() => setHoverText("Ask better questions. Get clearer answers.")}
      onMouseLeave={() => setHoverText("")}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-foreground text-sm">
              {displayedText}
              {isTyping && <span className="cursor-blink ml-1">|</span>}
            </p>
          </div>
        </div>

        {showResponse && (
          <motion.div
            initial={{ opacity: 0.4 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.5 }}
            className="flex items-start gap-3"
          >
            <div className="w-2 h-2 rounded-full bg-muted-foreground mt-2 flex-shrink-0" />
            <p className="text-muted-foreground text-sm italic">{currentResponse}</p>
          </motion.div>
        )}

        {hoverText && (
          <div className="absolute inset-0 flex items-center justify-center bg-card/50 backdrop-blur-sm rounded-2xl transition-opacity">
            <p className="text-foreground text-sm font-medium">{hoverText}</p>
          </div>
        )}
      </div>
    </div>
  );
}

