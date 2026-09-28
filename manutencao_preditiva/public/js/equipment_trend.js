// Copyright (c) 2026, Dércio Bobo and contributors
// For license information, please see license.txt

// Trend of one equipment's readings over its sheets - velocity (mm/s) and
// acceleration (g's), one line per measurement point. Shared by the
// Equipment form and the client portal's finding dialog (loaded on every
// desk page through app_include_js). Data: manutencao_preditiva.trend.
frappe.provide("manutencao_preditiva");

manutencao_preditiva.render_equipment_trend = function ($wrapper, equipment) {
	$wrapper.empty();
	if (!equipment) return;
	const $box = $('<div class="mp-trend">').appendTo($wrapper);
	$(`<div class="mp-trend-empty">${__("Loading trend…")}</div>`).appendTo($box);

	frappe
		.call({ method: "manutencao_preditiva.trend.equipment_trend", args: { equipment } })
		.then((r) => {
			const data = r.message || {};
			$box.empty();
			if (!data.periods || data.periods.length < 2) {
				$(`<div class="mp-trend-empty">${__("The trend appears once there are readings from two periods.")}</div>`).appendTo(
					$box
				);
				return;
			}
			const labels = data.periods.map((p) => p.label);
			[
				["velocity", __("Velocity (mm/s)")],
				["acceleration", __("Acceleration (g's)")],
			].forEach(([key, title]) => {
				const series = data[key] || {};
				const points = Object.keys(series);
				if (!points.length) return;
				const $chart = $('<div class="mp-trend-chart">').appendTo($box);
				$(`<div class="mp-trend-title">${title}</div>`).appendTo($chart);
				const target = $("<div>").appendTo($chart)[0];
				new frappe.Chart(target, {
					type: "line",
					height: 200,
					data: {
						labels,
						// A point not measured in a period shows as 0 - frappe.Chart
						// has no gaps.
						datasets: points.map((point) => ({ name: point, values: series[point].map((v) => v || 0) })),
					},
					lineOptions: { dotSize: 4, regionFill: 0 },
					axisOptions: { xIsSeries: 1 },
					tooltipOptions: { formatTooltipY: (v) => (v ? `${v}` : "—") },
				});
			});
		});
};
