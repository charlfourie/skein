// Skein for Unity — a ready-to-use dialogue box (no scene setup or prefabs needed).
//
// Add it to any GameObject (for example the one with SkeinRunner). It shows the
// speaker, the line and any choices at the bottom of the screen.
//   Continue: Space, Enter, E, or click.   Choose: 1–9, or click.
// While a conversation is open it can disable player-control scripts (e.g. the
// ThirdPersonController) and free the mouse cursor, and restores both afterwards.
//
// It draws with Unity's immediate-mode GUI so it works anywhere straight away.
// For the final game, replace it with your own UI that listens to
// SkeinRunner.BeatChanged (or the onLine / onChoice / onFlowEnded events).

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Skein.Unity
{
    [AddComponentMenu("Skein/Skein Dialogue Box")]
    public sealed class SkeinDialogueBox : MonoBehaviour
    {
        [Tooltip("Leave empty to use SkeinRunner.Instance.")]
        [SerializeField] SkeinRunner runner;

        [Tooltip("Scripts to switch off while a conversation is open (e.g. player movement and camera look).")]
        [SerializeField] Behaviour[] disableWhileTalking = new Behaviour[0];

        [Tooltip("Unlock and show the mouse cursor while a conversation is open.")]
        [SerializeField] bool freeCursor = true;

        [Header("Look")]
        [Range(0.2f, 1f)] [SerializeField] float width = 0.7f;
        [SerializeField] Color background = new Color(0.04f, 0.05f, 0.07f, 0.92f);
        [SerializeField] Color textColor = new Color(0.9f, 0.91f, 0.94f);
        [SerializeField] Color narratorColor = new Color(0.62f, 0.65f, 0.72f);
        [SerializeField] Color defaultSpeakerColor = new Color(0.98f, 0.75f, 0.14f);

        SkeinRunner subscribed;
        SkeinBeat beat;
        int beatFrame;
        bool open;
        readonly List<Behaviour> disabled = new List<Behaviour>();
        CursorLockMode savedLock;
        bool savedVisible;
        Texture2D bg;
        GUIStyle boxStyle, speakerStyle, lineStyle, choiceStyle, hintStyle;
        int stylesFor = -1;

        SkeinRunner Runner => runner != null ? runner : SkeinRunner.Instance;

        void OnEnable() => Subscribe();

        void OnDisable()
        {
            if (subscribed != null) subscribed.BeatChanged -= OnBeat;
            subscribed = null;
            Close();
        }

        void Subscribe()
        {
            var r = Runner;
            if (r == subscribed || r == null) return;
            if (subscribed != null) subscribed.BeatChanged -= OnBeat;
            subscribed = r;
            r.BeatChanged += OnBeat;
            if (r.IsPlaying) OnBeat(r.Beat);
        }

        void OnBeat(SkeinBeat b)
        {
            beatFrame = Time.frameCount;
            if (b == null || b.Kind == SkeinBeatKind.End) { beat = null; Close(); return; }
            beat = b;
            Open();
        }

        void Open()
        {
            if (open) return;
            open = true;
            disabled.Clear();
            foreach (var behaviour in disableWhileTalking)
            {
                if (behaviour == null || !behaviour.enabled) continue;
                behaviour.enabled = false;
                disabled.Add(behaviour);
            }
            if (freeCursor)
            {
                savedLock = Cursor.lockState;
                savedVisible = Cursor.visible;
                Cursor.lockState = CursorLockMode.None;
                Cursor.visible = true;
            }
        }

        void Close()
        {
            if (!open) return;
            open = false;
            foreach (var behaviour in disabled) if (behaviour != null) behaviour.enabled = true;
            disabled.Clear();
            if (freeCursor)
            {
                Cursor.lockState = savedLock;
                Cursor.visible = savedVisible;
            }
        }

        void Update()
        {
            if (subscribed == null) Subscribe();
            if (beat == null || Time.frameCount == beatFrame) return; // ignore the key press that opened it
            var keyboard = Keyboard.current;
            if (keyboard == null) return;

            if (beat.IsChoice)
            {
                for (int i = 0; i < beat.Choices.Count && i < 9; i++)
                    if (keyboard[Key.Digit1 + i].wasPressedThisFrame || keyboard[Key.Numpad1 + i].wasPressedThisFrame) { Choose(i); return; }
            }
            else if (keyboard.spaceKey.wasPressedThisFrame || keyboard.enterKey.wasPressedThisFrame || keyboard.numpadEnterKey.wasPressedThisFrame || keyboard.eKey.wasPressedThisFrame)
            {
                Choose(0);
            }
        }

        void Choose(int index) => subscribed?.Choose(index);

        void EnsureStyles()
        {
            if (stylesFor == Screen.height && boxStyle != null) return;
            stylesFor = Screen.height;
            int font = Mathf.Max(12, Mathf.RoundToInt(Screen.height / 42f));
            if (bg == null)
            {
                bg = new Texture2D(1, 1) { hideFlags = HideFlags.HideAndDontSave };
            }
            bg.SetPixel(0, 0, background);
            bg.Apply();
            boxStyle = new GUIStyle { normal = { background = bg }, padding = new RectOffset(font, font, font, font) };
            speakerStyle = new GUIStyle(GUI.skin.label) { fontSize = font, fontStyle = FontStyle.Bold, wordWrap = true };
            lineStyle = new GUIStyle(GUI.skin.label) { fontSize = font, wordWrap = true, richText = false, normal = { textColor = textColor } };
            choiceStyle = new GUIStyle(GUI.skin.button) { fontSize = font, alignment = TextAnchor.MiddleLeft, wordWrap = true, padding = new RectOffset(font / 2, font / 2, font / 3, font / 3) };
            hintStyle = new GUIStyle(GUI.skin.label) { fontSize = Mathf.RoundToInt(font * 0.75f), alignment = TextAnchor.LowerRight, normal = { textColor = narratorColor } };
        }

        Color SpeakerColor(string speaker)
        {
            var data = subscribed?.Data;
            if (data == null || speaker == null || !data.Entities.TryGetValue(speaker, out var entity)) return defaultSpeakerColor;
            if (data.Templates.TryGetValue(entity.Template ?? "", out var template))
                foreach (var kv in template.Properties)
                    if (kv.Value.Type == "color" && entity.Values.TryGetValue(kv.Key, out var v) && v is string hex && ColorUtility.TryParseHtmlString(hex, out var c))
                        return c;
            return defaultSpeakerColor;
        }

        void OnGUI()
        {
            if (beat == null || subscribed == null) return;
            EnsureStyles();

            float w = Screen.width * width;
            float x = (Screen.width - w) / 2f;
            float inner = w - boxStyle.padding.horizontal;

            // Measure
            string speaker = beat.Kind == SkeinBeatKind.Line ? subscribed.SpeakerName(beat.Speaker) : null;
            float h = boxStyle.padding.vertical;
            if (speaker != null) h += speakerStyle.CalcHeight(new GUIContent(speaker), inner) + 4;
            if (beat.Kind == SkeinBeatKind.Line) h += lineStyle.CalcHeight(new GUIContent(beat.Text), inner) + 8;
            if (beat.IsChoice)
                for (int i = 0; i < beat.Choices.Count; i++)
                    h += choiceStyle.CalcHeight(new GUIContent($"{i + 1}.  {beat.Choices[i].Text}"), inner) + 6;
            else h += hintStyle.fontSize + 6;

            var rect = new Rect(x, Screen.height - h - Screen.height * 0.05f, w, h);
            GUILayout.BeginArea(rect, boxStyle);
            if (speaker != null)
            {
                speakerStyle.normal.textColor = SpeakerColor(beat.Speaker);
                GUILayout.Label(speaker, speakerStyle);
            }
            if (beat.Kind == SkeinBeatKind.Line)
            {
                lineStyle.normal.textColor = beat.Speaker == null ? narratorColor : textColor;
                GUILayout.Label(beat.Text, lineStyle);
                GUILayout.Space(8);
            }
            if (beat.IsChoice)
            {
                for (int i = 0; i < beat.Choices.Count; i++)
                    if (GUILayout.Button($"{i + 1}.  {beat.Choices[i].Text}", choiceStyle)) Choose(i);
            }
            else
            {
                bool last = beat.Choices.Count == 0;
                if (GUILayout.Button(last ? "End ▸" : "Continue ▸", hintStyle)) Choose(0);
            }
            GUILayout.EndArea();
        }

        void OnDestroy()
        {
            if (bg != null) Destroy(bg);
        }
    }
}
