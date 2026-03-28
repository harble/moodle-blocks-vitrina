<?php
// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * List of available courses.
 *
 * @package   block_vitrina
 * @copyright 2023 David Herney @ BambuCo
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once('../../config.php');
require_once('classes/output/catalog.php');

$instanceid = optional_param('id', 0, PARAM_INT);
$view = optional_param('view', 'default', PARAM_TEXT);
$filters = optional_param('filters', '', PARAM_TEXT);
$q = optional_param('q', '', PARAM_TEXT);

require_login(null, true);

$syscontext = context_system::instance();

$PAGE->set_context($syscontext);
$PAGE->set_url('/blocks/vitrina/index.php');
$PAGE->set_pagelayout('incourse');
$PAGE->set_heading(get_string('catalog', 'block_vitrina'));
$PAGE->set_title(get_string('catalog', 'block_vitrina'));

$uniqueid = \block_vitrina\local\controller::get_uniqueid();
\block_vitrina\local\controller::include_templatecss($instanceid);

$bypage = get_config('block_vitrina', 'amount');
if (empty($bypage)) {
    $bypage = 20;
}

$filtersselected = [];

if (!empty($filters)) {
    $filters = explode(';', $filters);

    $configuredcustomfields = \block_vitrina\local\controller::get_configuredcustomfields();
    $staticfilters = \block_vitrina\local\controller::get_staticfilters();

    foreach ($filters as $filter) {
        $filter = explode(':', $filter);

        if (count($filter) == 2) {
            $key = trim($filter[0]);

            // If the filter is categories and the block is configured to show specific categories, we ignore the filter.
            if ($key == 'categories' && !empty($instanceid)) {
                continue;
            }

            if (!in_array($key, $staticfilters) && !is_numeric($key)) {
                foreach ($configuredcustomfields as $customfield) {
                    if ($customfield->shortname == $key) {
                        $key = $customfield->id;
                        break;
                    }
                }
            }

            if ($key) {
                $filtersselected[] = (object) ['key' => $key, 'values' => explode(',', $filter[1])];
            }
        }
    }
}

if (!empty($q)) {
    $filtersselected[] = (object) ['key' => 'fulltext', 'values' => [$q]];
}

$categoriesids = [];
if (!empty($instanceid)) {
    $block = block_instance_by_id($instanceid);

    if ($block->config && count($block->config->categories) > 0) {
        $categoriesids = $block->config->categories;
    }
}

if (count($categoriesids) > 0) {
    $filtersselected[] = (object) ['key' => 'categories', 'values' => $categoriesids];
}

// If no category filter has been defined (neither via URL filters nor block
// instance configuration), but the catalog is configured to show a category
// filter, preselect all available categories so that the UI state matches the
// "search in all categories" behaviour.
$hascategoriesfilter = false;
foreach ($filtersselected as $selected) {
    if ($selected->key === 'categories') {
        $hascategoriesfilter = true;
        break;
    }
}

if (!$hascategoriesfilter) {
    $staticfilters = get_config('block_vitrina', 'staticfilters');
    $staticfilters = $staticfilters ? explode(',', $staticfilters) : [];

    if (in_array('categories', $staticfilters)) {
        $catfilterview = get_config('block_vitrina', 'catfilterview');
        $nested = $catfilterview == 'tree';

        $categoriesoptions = \block_vitrina\local\controller::get_categories([], $nested);
        $allcatids = [];

        $collect = function(array $options) use (&$allcatids, &$collect) {
            foreach ($options as $opt) {
                if (!empty($opt->value)) {
                    $allcatids[] = (string)$opt->value;
                }
                if (!empty($opt->childs) && is_array($opt->childs)) {
                    $collect($opt->childs);
                }
            }
        };

        if (!empty($categoriesoptions)) {
            $collect($categoriesoptions);
        }

        if (!empty($allcatids)) {
            $allcatids = array_values(array_unique($allcatids));
            $filtersselected[] = (object) ['key' => 'categories', 'values' => $allcatids];
        }
    }
}

$PAGE->requires->js_call_amd('block_vitrina/main', 'filters', [$uniqueid, $filtersselected]);
$PAGE->requires->js_call_amd('block_vitrina/main', 'catalog', [$uniqueid, $view, $instanceid, $bypage]);

echo $OUTPUT->header();

$summary = get_config('block_vitrina', 'summary');

echo format_text($summary, FORMAT_HTML, ['trusted' => true, 'noclean' => true]);

$renderable = new \block_vitrina\output\catalog($uniqueid, $view, $instanceid);
$renderer = $PAGE->get_renderer('block_vitrina');

echo $renderer->render($renderable);

echo $OUTPUT->footer();
