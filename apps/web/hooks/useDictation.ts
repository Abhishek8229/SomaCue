"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionEventLike = Event & {
  results: SpeechRecognitionResultList;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

export function useDictation() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    const Recognition =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let finalizedText = "";

      for (let index = event.results.length - 1; index >= 0; index -= 1) {
        const result = event.results[index];
        if (result?.isFinal) {
          finalizedText = result[0]?.transcript.trim() ?? "";
          break;
        }
      }

      if (finalizedText) {
        setTranscript((current) =>
          current ? `${current} ${finalizedText}` : finalizedText,
        );
      }
    };
    recognition.onerror = () => {
      setIsListening(false);
    };
    recognition.onend = () => {
      setIsListening(false);
    };
    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, []);

  const startListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || isListening) {
      return;
    }

    recognition.start();
    setIsListening(true);
  }, [isListening]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setIsListening(false);
  }, []);

  return { isListening, transcript, startListening, stopListening };
}
