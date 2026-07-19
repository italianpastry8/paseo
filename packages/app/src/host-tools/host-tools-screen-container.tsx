/**
 * Host tools screen chrome — the centered max-width column that wraps the
 * three tool screens. The content width is bounded at `MAX_CONTENT_WIDTH`
 * (820) so the design remains compact-first on phone and centred-but-bounded
 * on desktop. The header lives in the route; this is just the content frame.
 */
import type { ReactNode } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";

interface HostToolsScreenContainerProps {
  children: ReactNode;
  /** Optional scroll behavior override. Default: `ScrollView`. */
  scrollable?: boolean;
  /** Optional `testID` for the content frame. */
  testID?: string;
}

export function HostToolsScreenContainer({
  children,
  scrollable = true,
  testID,
}: HostToolsScreenContainerProps): ReactNode {
  const body = (
    <View style={styles.content} testID={testID}>
      {children}
    </View>
  );

  if (!scrollable) {
    return <View style={styles.frame}>{body}</View>;
  }

  return (
    <View style={styles.frame}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  frame: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[4],
    },
    paddingVertical: theme.spacing[4],
  },
  content: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    gap: theme.spacing[4],
  },
}));
