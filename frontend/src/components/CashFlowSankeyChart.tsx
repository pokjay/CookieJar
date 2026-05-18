"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
import type { SankeyData } from "@/lib/types";

const SANKEY_PALETTE = [
  "#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854",
  "#ffd92f", "#e5c494", "#b3b3b3", "#ff7f7f", "#7fc97f",
];

function buildOptions(
  data: SankeyData,
  expandableSet: Set<string>,
  expandedSet: Set<string>,
  year: number,
  isDark: boolean,
) {
  const nodeColors: Record<string, string> = {};
  let catIdx = 0;
  for (const node of data.nodes) {
    const { name, depth } = node;
    if (name === "Income") {
      nodeColors[name] = "#2ecc71";
    } else if (name === "Savings") {
      nodeColors[name] = "#3498db";
    } else if (depth === 2) {
      const parent = name.split(" — ")[0];
      nodeColors[name] = nodeColors[parent] ?? "#999999";
    } else {
      nodeColors[name] = SANKEY_PALETTE[catIdx % SANKEY_PALETTE.length];
      catIdx++;
    }
  }

  const styledNodes = data.nodes.map((node) => ({
    name: node.name,
    depth: node.depth,
    itemStyle: {
      color: nodeColors[node.name] ?? "#999999",
      borderWidth: expandableSet.has(node.name) ? 2 : 0,
      borderColor: expandedSet.has(node.name) ? "#ffffff88" : "transparent",
    },
    cursor: expandableSet.has(node.name) ? "pointer" : "default",
  }));

  return {
    title: {
      text: `Yearly Cash Flow — ${year}`,
      left: "center",
      textStyle: {
        color: isDark ? "#9CA3AF" : "#7a5a40",
        fontSize: 13,
        fontWeight: 500,
      },
    },
    tooltip: {
      trigger: "item",
      triggerOn: "mousemove",
      formatter: (params: { name: string; value: number }) =>
        `${params.name}: ₪${Number(params.value).toLocaleString()}`,
      backgroundColor: isDark ? "#1f2937" : "#ecdfbb",
      borderColor:     isDark ? "#374151" : "#c0ae88",
      textStyle: { color: isDark ? "#f3f4f6" : "#2a1d10", fontSize: 12 },
    },
    series: [
      {
        type: "sankey",
        data: styledNodes,
        links: data.links,
        emphasis: { focus: "adjacency" },
        lineStyle: {
          color: "gradient",
          curveness: 0.5,
          opacity: isDark ? 0.2 : 0.45,
        },
        label: {
          fontSize: 12,
          color: isDark ? "#d1d5db" : "#2a1d10",
        },
        nodeGap: 12,
        nodeWidth: 20,
        layoutIterations: 0,
      },
    ],
  };
}

interface CashFlowSankeyChartProps {
  data: SankeyData | null;
  year: number;
  expandedCategories: Set<string>;
  onToggleCategory: (name: string) => void;
}

export default function CashFlowSankeyChart({
  data,
  year,
  expandedCategories,
  onToggleCategory,
}: CashFlowSankeyChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const expandableSet = useMemo(
    () => new Set(data?.expandable_categories ?? []),
    [data?.expandable_categories],
  );

  const onEvents = useMemo(
    () => ({
      click: (params: { dataType: string; name: string }) => {
        if (params.dataType === "node" && expandableSet.has(params.name)) {
          onToggleCategory(params.name);
        }
      },
    }),
    [expandableSet, onToggleCategory],
  );

  const options = useMemo(
    () => data ? buildOptions(data, expandableSet, expandedCategories, year, isDark) : null,
    [data, expandableSet, expandedCategories, year, isDark],
  );

  if (!data) return null;

  if (!data.nodes.length) {
    return (
      <div className="bg-cj-surface border border-cj-border rounded-xl p-6 flex items-center justify-center h-48">
        <p className="text-cj-text-faint text-sm">No data available for this year.</p>
      </div>
    );
  }

  return (
    <div className="bg-cj-surface border border-cj-border rounded-xl p-6">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-medium text-cj-text-muted">Yearly Cash Flow</h3>
        {data.expandable_categories.length > 0 && (
          <p className="text-xs text-cj-text-faint">Click a category to expand subcategories</p>
        )}
      </div>
      <ReactECharts
        option={options!}
        style={{ height: "500px" }}
        onEvents={onEvents}
        notMerge
      />
    </div>
  );
}
