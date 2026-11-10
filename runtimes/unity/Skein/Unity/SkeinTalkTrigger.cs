// Skein for Unity — starts a flow when the player is in range and presses a key.
//
// Put it on an object with a trigger collider (Is Trigger ticked). When a collider
// tagged "Player" is inside, an on-screen prompt appears; pressing the key plays
// the flow. The flow's own start-node requirements decide whether it can run, so
// state-dependent conversations need no extra code here.

using UnityEngine;
using UnityEngine.InputSystem;

namespace Skein.Unity
{
    [AddComponentMenu("Skein/Skein Talk Trigger")]
    [RequireComponent(typeof(Collider))]
    public sealed class SkeinTalkTrigger : MonoBehaviour
    {
        [Tooltip("The Skein flow to play (its name as shown in Skein, or its id).")]
        [SerializeField] string flow = "";

        [Tooltip("Shown while the player is in range.")]
        [SerializeField] string prompt = "Press E to interact";

        [SerializeField] Key key = Key.E;

        [Tooltip("Tag of the object that can trigger the conversation.")]
        [SerializeField] string playerTag = "Player";

        [Tooltip("Play as soon as the player walks in, without a key press.")]
        [SerializeField] bool playOnEnter;

        [Tooltip("Only ever play once.")]
        [SerializeField] bool once;

        [Tooltip("Leave empty to use SkeinRunner.Instance.")]
        [SerializeField] SkeinRunner runner;

        bool inRange;
        bool played;

        SkeinRunner Runner => runner != null ? runner : SkeinRunner.Instance;

        void Reset()
        {
            var col = GetComponent<Collider>();
            if (col != null) col.isTrigger = true;
        }

        void OnTriggerEnter(Collider other)
        {
            if (!other.CompareTag(playerTag)) return;
            inRange = true;
            if (playOnEnter) TryPlay();
        }

        void OnTriggerExit(Collider other)
        {
            if (other.CompareTag(playerTag)) inRange = false;
        }

        void Update()
        {
            if (!inRange || playOnEnter) return;
            var keyboard = Keyboard.current;
            if (keyboard != null && keyboard[key].wasPressedThisFrame) TryPlay();
        }

        /// <summary>Play the flow now (also callable from UnityEvents or other scripts).</summary>
        public void TryPlay()
        {
            var r = Runner;
            if (r == null) { Debug.LogError("[Skein] No SkeinRunner in the scene.", this); return; }
            if (r.IsPlaying || (once && played)) return;
            if (r.Play(flow)) played = true;
        }

        bool ShowPrompt
        {
            get
            {
                var r = Runner;
                return inRange && !playOnEnter && !(once && played) && r != null && !r.IsPlaying && !string.IsNullOrEmpty(prompt);
            }
        }

        void OnGUI()
        {
            if (!ShowPrompt) return;
            var style = new GUIStyle(GUI.skin.box) { fontSize = Mathf.RoundToInt(Screen.height / 40f), alignment = TextAnchor.MiddleCenter };
            var size = style.CalcSize(new GUIContent(prompt)) + new Vector2(24, 12);
            GUI.Box(new Rect((Screen.width - size.x) / 2f, Screen.height * 0.62f, size.x, size.y), prompt, style);
        }
    }
}
