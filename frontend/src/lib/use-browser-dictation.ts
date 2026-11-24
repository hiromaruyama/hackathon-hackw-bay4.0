"use client";

import { useEffect, useRef, useState } from "react";

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type DictationStatus = "idle" | "starting" | "listening" | "finishing";
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};

export function useBrowserDictation(onTranscript: (text: string) => void, onError: (message: string) => void) {
  const active = useRef<Recognition | null>(null);
  const [status, setStatus] = useState<DictationStatus>("idle");

  useEffect(() => () => {
    const recognition = active.current;
    active.current = null;
    recognition?.abort();
  }, []);

  function finish(recognition: Recognition) {
    if (active.current !== recognition) return;
    active.current = null;
    setStatus("idle");
  }

  function toggle() {
    const current = active.current;
    if (current) {
      if (status === "starting") {
        finish(current);
        current.abort();
        return;
      }
      setStatus("finishing");
      try {
        current.stop();
      } catch {
        current.abort();
        finish(current);
      }
      return;
    }

    const speech = window as SpeechWindow;
    const Recognizer = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
    if (!Recognizer) {
      onError("This browser doesn't support speech dictation. You can type your message below.");
      return;
    }

    const recognition = new Recognizer();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      if (active.current === recognition) setStatus((current) => current === "starting" ? "listening" : current);
    };
    recognition.onend = () => finish(recognition);
    recognition.onresult = (event) => {
      if (active.current !== recognition) return;
      const transcript = Array.from(event.results)
        .slice(event.resultIndex)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript.trim())
        .join(" ")
        .trim();
      if (transcript) onTranscript(transcript);
    };
    recognition.onerror = ({ error }) => {
      if (active.current !== recognition) return;
      finish(recognition);
      if (error === "aborted") return;
      if (error === "not-allowed" || error === "service-not-allowed") {
        onError("Allow microphone access to use dictation.");
      } else if (error === "no-speech") {
        onError("No speech was detected. Tap the microphone and try again.");
      } else {
        onError("Dictation couldn't capture your message. Check your microphone and try again.");
      }
    };

    active.current = recognition;
    setStatus("starting");
    try {
      recognition.start();
    } catch {
      finish(recognition);
      onError("Couldn't start the microphone. Try again.");
    }
  }

  return { status, toggle };
}
