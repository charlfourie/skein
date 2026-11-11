// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Charl Fourie. See runtimes/LICENSE.
// Skein for Unity — loads a Skein game export and plays its flows.
//
// Setup: export from Skein (File › Export for Game Engine…, saved as a .json file
// anywhere under Assets/), drop this component on one GameObject in the scene, and
// drag the exported file into "Export File". Then call Play("Flow name") — or use
// SkeinTalkTrigger — and show beats with SkeinDialogueBox or your own UI.

using System;
using UnityEngine;
using UnityEngine.Events;

namespace Skein.Unity
{
    [Serializable] public class SkeinBeatEvent : UnityEvent<SkeinBeat> { }
    [Serializable] public class SkeinFlowEvent : UnityEvent<string> { }

    [DisallowMultipleComponent]
    [AddComponentMenu("Skein/Skein Runner")]
    public sealed class SkeinRunner : MonoBehaviour
    {
        [Tooltip("A Skein game export (.json), from File › Export for Game Engine in Skein.")]
        [SerializeField] TextAsset exportFile;

        [Tooltip("Keep this runner (and the story state) alive across scene loads.")]
        [SerializeField] bool dontDestroyOnLoad = true;

        [Tooltip("Write time and rule activity to the Console.")]
        [SerializeField] bool logActivity;

        [Tooltip("Dice (chance/roll) seed for a new game. 0 = a different seed every run. A loaded save keeps its own dice.")]
        [SerializeField] int diceSeed;

        [Header("Events")]
        public SkeinBeatEvent onLine = new SkeinBeatEvent();
        public SkeinBeatEvent onChoice = new SkeinBeatEvent();
        /// <summary>Raised with the flow's name when a flow ends.</summary>
        public SkeinFlowEvent onFlowEnded = new SkeinFlowEvent();

        /// <summary>The first runner in the scene. Most games only need one.</summary>
        public static SkeinRunner Instance { get; private set; }

        public SkeinExport Data { get; private set; }
        public SkeinWorld World { get; private set; }
        public SkeinStory Story { get; private set; }
        public SkeinBeat Beat { get; private set; }

        /// <summary>True from Play() until the flow reaches its end.</summary>
        public bool IsPlaying => Story != null && Beat != null && Beat.Kind != SkeinBeatKind.End;

        /// <summary>Raised for every beat (lines, choices and the end).</summary>
        public event Action<SkeinBeat> BeatChanged;

        void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Debug.LogWarning("[Skein] More than one SkeinRunner in the scene; keeping the first.", this);
                Destroy(gameObject);
                return;
            }
            Instance = this;
            if (dontDestroyOnLoad) DontDestroyOnLoad(gameObject);
            if (exportFile != null) Load(exportFile.text);
            else Debug.LogWarning("[Skein] No export file assigned to the SkeinRunner.", this);
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        /// <summary>Load an export (replacing any current story and state).</summary>
        public void Load(string exportJson, SkeinSave saved = null)
        {
            try
            {
                Data = SkeinExport.Parse(exportJson);
            }
            catch (Exception e)
            {
                Debug.LogError($"[Skein] Couldn't read the export: {e.Message}", this);
                return;
            }
            NewWorld(saved);
        }

        /// <summary>Start the state over from the export's starting values (e.g. when a time loop resets).</summary>
        public void ResetWorld() => NewWorld(null);

        void NewWorld(SkeinSave saved)
        {
            uint seed = diceSeed != 0 ? unchecked((uint)diceSeed) : unchecked((uint)Environment.TickCount ^ (uint)DateTime.UtcNow.Ticks);
            World = new SkeinWorld(Data, saved, seed);
            if (logActivity) World.TimeAdvanced += FlushLog;
            Story = null;
            Beat = null;
        }

        void FlushLog(SkeinWorld w)
        {
            foreach (var line in w.Log) Debug.Log("[Skein] " + line, this);
            w.Log.Clear();
        }

        /// <summary>True when the export has a flow with this name or id.</summary>
        public bool HasFlow(string flowNameOrId) => Data?.FindFlow(flowNameOrId) != null;

        /// <summary>
        /// Start a flow by name (or id). Returns false when the flow doesn't exist, or none
        /// of its start nodes is available right now (their requirements don't hold).
        /// </summary>
        public bool Play(string flowNameOrId, string startNodeId = null)
        {
            if (World == null) { Debug.LogError("[Skein] No export loaded.", this); return false; }
            if (!HasFlow(flowNameOrId)) { Debug.LogError($"[Skein] No flow “{flowNameOrId}” in {Data.ProjectName}.", this); return false; }
            Story = new SkeinStory(World, flowNameOrId);
            var beat = Story.Start(startNodeId);
            if (beat.Kind == SkeinBeatKind.End && beat.Node == null)
            {
                Story = null;
                Beat = null;
                return false;
            }
            Show(beat);
            return true;
        }

        /// <summary>Continue past a line that has a single way on.</summary>
        public void Continue() => Choose(0);

        /// <summary>Pick a choice by its index in Beat.Choices.</summary>
        public void Choose(int index)
        {
            if (!IsPlaying) return;
            Show(Story.Choose(index));
        }

        /// <summary>Stop the current flow without finishing it.</summary>
        public void Stop()
        {
            if (!IsPlaying) return;
            var name = Story.Flow.Name;
            Story = null;
            Beat = null;
            onFlowEnded.Invoke(name);
        }

        void Show(SkeinBeat beat)
        {
            Beat = beat;
            BeatChanged?.Invoke(beat);
            switch (beat.Kind)
            {
                case SkeinBeatKind.Line: onLine.Invoke(beat); break;
                case SkeinBeatKind.Choice: onChoice.Invoke(beat); break;
                case SkeinBeatKind.End: onFlowEnded.Invoke(Story.Flow.Name); break;
            }
            if (logActivity && World.Log.Count > 0) FlushLog(World);
        }

        // --- Helpers for game code -----------------------------------------------------

        /// <summary>Display name for a speaker's technical name (falls back to the name).</summary>
        public string SpeakerName(string speaker)
        {
            if (speaker == null) return null;
            return Data != null && Data.Entities.TryGetValue(speaker, out var e) && !string.IsNullOrEmpty(e.DisplayName) ? e.DisplayName : speaker;
        }

        // --- Saving --------------------------------------------------------------------

        /// <summary>The story state as JSON: current day and phase plus every changed value.</summary>
        public string SaveToJson() => World?.Save().ToJson();

        /// <summary>Restore state saved with SaveToJson. Works across new exports that add content.</summary>
        public void LoadFromJson(string saveJson)
        {
            if (Data == null) { Debug.LogError("[Skein] Load an export before restoring a save.", this); return; }
            NewWorld(SkeinSave.FromJson(saveJson));
        }

        /// <summary>Save into PlayerPrefs under the given key.</summary>
        public void SaveToPlayerPrefs(string key = "skein.save")
        {
            PlayerPrefs.SetString(key, SaveToJson());
            PlayerPrefs.Save();
        }

        /// <summary>Restore from PlayerPrefs. Returns false when there is no save under the key.</summary>
        public bool LoadFromPlayerPrefs(string key = "skein.save")
        {
            if (!PlayerPrefs.HasKey(key)) return false;
            LoadFromJson(PlayerPrefs.GetString(key));
            return true;
        }
    }
}
