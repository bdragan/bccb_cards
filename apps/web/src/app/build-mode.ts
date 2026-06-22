export const isStaticCpuOnlyBuild =
  import.meta.env.VITE_STATIC_CPU_ONLY === "true";

export const isStaticCpuHandDebugBuild =
  import.meta.env.VITE_STATIC_CPU_HAND_DEBUG === "true";
