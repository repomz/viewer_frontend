import { forwardRef } from "react";
import { Platform, ScrollView as NativeScrollView, type ScrollViewProps, type ViewStyle } from "react-native";

// Contain each list's scrolling so reaching an edge cannot drag its parent
// screen or expose blank space. Horizontal timelines keep their own axis.
export const ScrollView = forwardRef<NativeScrollView, ScrollViewProps>(
  function BoundedScrollView({ style, horizontal, ...props }, ref) {
    const webStyle = Platform.OS === "web" ? {
      overscrollBehavior: "none",
      overflowX: horizontal ? "auto" : "hidden",
      overflowY: horizontal ? "hidden" : "auto"
    } as ViewStyle : undefined;
    return (
      <NativeScrollView
        {...props}
        ref={ref}
        horizontal={horizontal}
        bounces={false}
        alwaysBounceVertical={false}
        alwaysBounceHorizontal={false}
        overScrollMode="never"
        style={[style, { minHeight: 0, minWidth: 0 }, webStyle]}
      />
    );
  }
);

export type ScrollViewHandle = NativeScrollView;
