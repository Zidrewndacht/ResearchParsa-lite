To update features/techniques (inside JSONs), at least the following is affected:

	globals.py: default_features, hardcoded cells

	Updating Paper Data (): no change
	Excel exports: pending changes

	index.html: th
	papers_table.html: td
	papers_table_tfoot.html: td

	index_static_export/ghpages: pending changes

	stats.js: 
		const FIELD_LABELS, FIELD_LABELS_FOR_YEARLY, featuresColorsOriginalOrder, featuresBorderColorsOriginalOrder, featureColorGroups
	filtering.js?
		applyLocalFilters()
			const *Features = []
			const featureFieldsToCheck
	comms.js: apparently no changes;
	globals.js: getElementById.


