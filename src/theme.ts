import { Platform, TextStyle, ViewStyle } from "react-native";

export const colors = {
  canvas: "#F3F6F8",
  canvasRaised: "#FFFFFF",
  surface: "#FFFFFF",
  surfaceHover: "#EAF1F5",
  surfaceSoft: "#F8FAFB",
  border: "#D4DFE6",
  borderSoft: "rgba(67, 91, 109, 0.14)",
  primary: "#0B84B3",
  primaryStrong: "#086F98",
  primarySoft: "rgba(11, 132, 179, 0.10)",
  text: "#17232D",
  textMuted: "#536776",
  textDim: "#81919D",
  success: "#0B947F",
  successSoft: "rgba(11, 148, 127, 0.10)",
  warning: "#C67C00",
  warningSoft: "rgba(198, 124, 0, 0.10)",
  danger: "#D9425C",
  dangerSoft: "rgba(217, 66, 92, 0.10)",
  white: "#FFFFFF",
  black: "#000000"
} as const;

export const darkColors = {
  canvas: "#1E2127",
  canvasRaised: "#24272D",
  surface: "#32353B",
  surfaceHover: "#3A3D44",
  border: "#DADADA",
  borderSoft: "rgba(250, 253, 255, 0.18)",
  primary: "#35C2FF",
  primarySoft: "rgba(53, 194, 255, 0.14)",
  text: "#FAFDFF",
  textMuted: "#D0D2D6",
  textDim: "#96999F"
} as const;

export const layout = {
  maxContent: 1440,
  sidebar: 244,
  details: 390,
  mobileBreakpoint: 760,
  tabletBreakpoint: 1080
} as const;

export const radii = {
  sm: 8,
  md: 8,
  lg: 20,
  xl: 24,
  pill: 999
} as const;

export const shadow: ViewStyle =
  Platform.OS === "web"
    ? ({
        boxShadow: "0 18px 50px rgba(0,0,0,0.25)"
      } as ViewStyle)
    : {
        shadowColor: colors.black,
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.28,
        shadowRadius: 30,
        elevation: 12
      };

export const typography = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: "700",
    letterSpacing: -0.6
  } satisfies TextStyle,
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700"
  } satisfies TextStyle,
  body: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "400"
  } satisfies TextStyle,
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600"
  } satisfies TextStyle,
  meta: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500"
  } satisfies TextStyle
};
