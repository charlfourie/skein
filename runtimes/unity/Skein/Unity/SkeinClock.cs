// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Charl Fourie. See runtimes/LICENSE.
// Skein for Unity — moves Skein's time forward in real time.
//
// Every "Seconds Per Phase" the world advances one phase (Dawn → Day → …), which
// runs that phase's rules in Skein and starts a new day after the last phase. Use
// it for near-real-time play; leave it off if time should only move through
// story effects ("advance" / "advance to" in Skein instructions).
//
// "Last Day" ends the loop: when the clock would move past it, onLoopEnded fires
// (and, if "Reset On Loop End" is on, the world starts over from day one).

using UnityEngine;
using UnityEngine.Events;

namespace Skein.Unity
{
    [AddComponentMenu("Skein/Skein Clock")]
    public sealed class SkeinClock : MonoBehaviour
    {
        [Tooltip("Leave empty to use SkeinRunner.Instance.")]
        [SerializeField] SkeinRunner runner;

        [Tooltip("Real seconds per Skein phase. 0 stops the clock.")]
        [Min(0)] [SerializeField] float secondsPerPhase = 120f;

        [Tooltip("Don't let time pass while a conversation is open.")]
        [SerializeField] bool pauseDuringDialogue = true;

        [Tooltip("The final day of the loop (0 = no limit).")]
        [Min(0)] [SerializeField] int lastDay = 5;

        [Tooltip("When the loop ends, restart the world from its starting state.")]
        [SerializeField] bool resetOnLoopEnd;

        [Tooltip("Show the day and phase in the top-left corner (handy while testing).")]
        [SerializeField] bool showHud = true;

        [Header("Events")]
        public UnityEvent onPhaseChanged = new UnityEvent();
        public UnityEvent onLoopEnded = new UnityEvent();

        float elapsed;
        bool ended;

        SkeinRunner Runner => runner != null ? runner : SkeinRunner.Instance;

        /// <summary>Seconds until the next phase begins.</summary>
        public float SecondsUntilNextPhase => Mathf.Max(0, secondsPerPhase - elapsed);

        /// <summary>0–1 progress through the current phase.</summary>
        public float PhaseProgress => secondsPerPhase <= 0 ? 0 : Mathf.Clamp01(elapsed / secondsPerPhase);

        public bool Paused { get; set; }

        void Update()
        {
            var r = Runner;
            if (r == null || r.World == null || secondsPerPhase <= 0 || ended || Paused) return;
            if (pauseDuringDialogue && r.IsPlaying) return;
            elapsed += Time.deltaTime;
            while (elapsed >= secondsPerPhase && !ended)
            {
                elapsed -= secondsPerPhase;
                Step(r);
            }
        }

        /// <summary>Advance one phase now (also callable from UnityEvents or a debug key).</summary>
        public void AdvancePhase()
        {
            var r = Runner;
            if (r?.World != null && !ended) Step(r);
        }

        void Step(SkeinRunner r)
        {
            var w = r.World;
            var phases = w.Data.Time.Phases.Count;
            bool wouldStartNewDay = phases > 0 && w.PhaseIndex == phases - 1;
            if (lastDay > 0 && wouldStartNewDay && w.Day >= lastDay)
            {
                EndLoop(r);
                return;
            }
            w.Advance(1);
            onPhaseChanged.Invoke();
        }

        void EndLoop(SkeinRunner r)
        {
            onLoopEnded.Invoke();
            if (resetOnLoopEnd)
            {
                r.Stop();
                r.ResetWorld();
                elapsed = 0;
            }
            else ended = true;
        }

        /// <summary>Start the clock again after the loop ended (e.g. after showing an ending).</summary>
        public void Restart(bool resetWorld = true)
        {
            if (resetWorld) Runner?.ResetWorld();
            elapsed = 0;
            ended = false;
        }

        void OnGUI()
        {
            if (!showHud) return;
            var w = Runner?.World;
            if (w == null) return;
            var label = w.Phase == null ? $"Day {w.Day}" : $"Day {w.Day} · {w.PhaseLabel}";
            if (secondsPerPhase > 0 && !ended) label += $"  ({Mathf.CeilToInt(SecondsUntilNextPhase)}s)";
            if (ended) label += "  — loop ended";
            GUI.Label(new Rect(12, 10, 400, 24), label);
        }
    }
}
