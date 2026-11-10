// Skein for Unity — turns a Skein value into Unity events, with no code.
//
// Example: variable "World.BunkerLightOn", and in "On True" switch a Light on.
// Fires once at start with the current value (if "Fire On Start" is ticked) and then
// every time the value changes, whether from dialogue, a rule, time passing or a save
// being loaded.

using System;
using UnityEngine;
using UnityEngine.Events;

namespace Skein.Unity
{
    [Serializable] public class SkeinBoolEvent : UnityEvent<bool> { }
    [Serializable] public class SkeinNumberEvent : UnityEvent<float> { }
    [Serializable] public class SkeinTextEvent : UnityEvent<string> { }

    [AddComponentMenu("Skein/Skein Variable Events")]
    public sealed class SkeinVariableEvents : MonoBehaviour
    {
        public enum Source { WorldVariable, EntityProperty }

        [SerializeField] Source source = Source.WorldVariable;

        [Tooltip("World variable, e.g. World.BunkerLightOn")]
        [SerializeField] string variable = "World.";

        [Tooltip("Entity property: the entity's technical name, e.g. Keeper")]
        [SerializeField] string entity = "";
        [Tooltip("Entity property: the property's technical name, e.g. Mood")]
        [SerializeField] string property = "";

        [SerializeField] bool fireOnStart = true;

        [Tooltip("Leave empty to use SkeinRunner.Instance.")]
        [SerializeField] SkeinRunner runner;

        [Header("Events")]
        public UnityEvent onTrue = new UnityEvent();
        public UnityEvent onFalse = new UnityEvent();
        public SkeinBoolEvent onBool = new SkeinBoolEvent();
        public SkeinNumberEvent onNumber = new SkeinNumberEvent();
        /// <summary>Text, enum option names and entity names arrive here (numbers and booleans as text too).</summary>
        public SkeinTextEvent onText = new SkeinTextEvent();

        SkeinWorld watched;
        bool hasLast;
        object last;

        SkeinRunner Runner => runner != null ? runner : SkeinRunner.Instance;

        void Start()
        {
            Attach();
            if (watched != null)
            {
                last = Current();
                hasLast = true;
                if (fireOnStart) Fire(last);
            }
        }

        // The runner replaces its world on ResetWorld / LoadFromJson; re-attach and report any difference.
        void Update()
        {
            var r = Runner;
            if (r == null || r.World == watched) return;
            Attach();
            Compare();
        }

        void OnDestroy() => Detach();

        void Attach()
        {
            Detach();
            watched = Runner?.World;
            if (watched != null) watched.Changed += OnChanged;
        }

        void Detach()
        {
            if (watched != null) watched.Changed -= OnChanged;
            watched = null;
        }

        string Key => source == Source.WorldVariable
            ? SkeinWorld.Key("var", variable, null, null, null)
            : SkeinWorld.Key("prop", null, entity, property, null);

        object Current() => source == Source.WorldVariable ? watched.GetVar(variable) : watched.GetProp(entity, property);

        void OnChanged(string key, object value)
        {
            if (key == Key) Compare();
        }

        void Compare()
        {
            if (watched == null) return;
            var now = Current();
            if (hasLast && SkeinValue.StrictEquals(now, last)) return;
            last = now;
            hasLast = true;
            Fire(now);
        }

        void Fire(object value)
        {
            bool truthy = SkeinValue.Truthy(value);
            if (truthy) onTrue.Invoke(); else onFalse.Invoke();
            onBool.Invoke(truthy);
            onNumber.Invoke((float)SkeinValue.ToNumber(value));
            onText.Invoke(value == null ? "" : SkeinValue.ToJsString(value));
        }
    }
}
