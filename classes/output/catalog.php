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
 * Class containing renderers for the block.
 *
 * @package   block_vitrina
 * @copyright 2023 David Herney @ BambuCo
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
namespace block_vitrina\output;

use renderable;
use renderer_base;
use templatable;

/**
 * Class containing data for the courses catalog.
 *
 * @copyright 2023 David Herney @ BambuCo
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class catalog implements renderable, templatable {
    /**
     * @var string The uniqueid of the block instance.
     */
    private $uniqueid;

    /**
     * @var string The view type.
     */
    private $view;

    /**
     * @var int The block instance id.
     */
    private $instanceid;

    /**
     * Constructor.
     *
     * @param string $uniqueid The uniqueid of the block instance.
     * @param string $view The view type.
     */
    public function __construct($uniqueid, $view = 'default', int $instanceid = 0) {

        $this->uniqueid = $uniqueid;
        $this->view = $view;
        $this->instanceid = $instanceid;
    }

    /**
     * Export this data so it can be used as the context for a mustache template.
     *
     * @param \renderer_base $output
     * @return array Context variables for the template
     */
    public function export_for_template(renderer_base $output) {
        global $CFG, $DB;

        $availableviews = \block_vitrina\local\controller::get_courses_views();

        $icons = \block_vitrina\local\controller::get_views_icons();

        $showtabs = [];
        foreach ($availableviews as $k => $view) {
            $one = new \stdClass();
            $one->title = get_string('tabtitle_' . $view, 'block_vitrina');
            $one->key = $view;
            $one->icon = $output->image_icon($icons[$view], $one->title);
            $one->state = $view == $this->view ? 'active' : '';
            $showtabs[] = $one;
        }

        // Filter controls.
        $filtercontrols = [];

        $staticfilters = get_config('block_vitrina', 'staticfilters');
        $staticfilters = explode(',', $staticfilters);

        // Detect if the current block instance has a tags filter configured.
        $instancetags = [];
        $hasconfigtags = false;

        if (!empty($this->instanceid)) {
            $block = block_instance_by_id($this->instanceid);
            if ($block && !empty($block->config) && !empty($block->config->tags)) {
                if (is_array($block->config->tags)) {
                    $instancetags = $block->config->tags;
                } else {
                    $instancetags = [$block->config->tags];
                }

                // Normalise and clean tag ids.
                $instancetags = array_map('intval', $instancetags);
                $instancetags = array_unique(array_filter($instancetags));

                if (!empty($instancetags)) {
                    $hasconfigtags = true;
                }
            }
        }

        // Tags as a dropdown (when there is no block-level tags filter
        // configured) OR as a checkbox list when the block has tags
        // configured.
        $tagsoptions = [];

        if ($hasconfigtags) {
            // Build a tags filter control similar to the categories one,
            // using only the tags configured in the block instance, and
            // mark all of them as selected by default.
            list($insql, $params) = $DB->get_in_or_equal($instancetags, SQL_PARAMS_NAMED, 'tagid');
            $tagrecords = $DB->get_records_select('tag', "id $insql", $params, 'name ASC', 'id, name');

            $tagcontroloptions = [];
            foreach ($tagrecords as $tagrecord) {
                $option = new \stdClass();
                $option->value = $tagrecord->id;
                $option->label = $tagrecord->name;
                $option->selected = true;
                $option->indent = 0;
                $tagcontroloptions[] = $option;
            }

            if (!empty($tagcontroloptions)) {
                $control = new \stdClass();
                $control->title = get_string('coursetagsfilter', 'block_vitrina');
                $control->key = 'tags';
                $control->options = $tagcontroloptions;
                $filtercontrols[] = $control;
            }
        } else {
            // No block-level tags configuration: expose all course tags as a
            // simple dropdown.
            $tagrecords = $DB->get_records_sql(
                "SELECT DISTINCT t.id, t.name
                   FROM {tag} t
                   JOIN {tag_instance} ti ON ti.tagid = t.id
                  WHERE ti.component = 'core' AND ti.itemtype = 'course'
               ORDER BY t.name ASC"
            );

            foreach ($tagrecords as $tagrecord) {
                $option = new \stdClass();
                $option->value = $tagrecord->id;
                $option->label = $tagrecord->name;
                $tagsoptions[] = $option;
            }
        }

        // Filter by category.
        $catfilterview = null;
        if (in_array('categories', $staticfilters)) {
            $catfilterview = get_config('block_vitrina', 'catfilterview');

            // When the admin selects "tree" in the Category filter view
            // setting, build the category list as a hierarchy; otherwise,
            // keep the original flat list behaviour.
            $nested = ($catfilterview == 'tree');

            $categoriesoptions = \block_vitrina\local\controller::get_categories([], $nested);

            if (count($categoriesoptions) > 1) {
                $control = new \stdClass();
                $control->title = get_string('category');
                $control->key = 'categories';
                $control->options = $categoriesoptions;
                $filtercontrols[] = $control;
            }
        }

        // Filter by language.
        if (in_array('langs', $staticfilters)) {
            $options = \block_vitrina\local\controller::get_languages();

            if (count($options) > 1) {
                $control = new \stdClass();
                $control->title = get_string('language');
                $control->key = 'langs';
                $control->options = $options;
                $filtercontrols[] = $control;
            }
        }

        // Filter by custom fields.

        // Add to filtercontrols the array returned by the method get_customfieldsfilters.
        $filtercontrols = array_merge($filtercontrols, \block_vitrina\local\controller::get_customfieldsfilters());

        $filterproperties = new \stdClass();

        if (in_array('fulltext', $staticfilters)) {
            $filterproperties->fulltext = true;
        }

        // Only show the tags dropdown when there is no block-level tags
        // configuration and there are tags to display.
        if (!$hasconfigtags && !empty($tagsoptions)) {
            $filterproperties->hastags = true;
        }
        // End of filter controls.

        $sortvalue = main::get_config_ex($this->instanceid ?: 0, 'block_vitrina', 'sortbydefault');
        if (empty($sortvalue)) {
            $sortvalue = 'default';
        }

        $sortdirectionvalue = main::get_config_ex($this->instanceid ?: 0, 'block_vitrina', 'sortdirection');
        if (empty($sortdirectionvalue)) {
            $sortdirectionvalue = 'asc';
        }

        $sortlabels = [
            'default' => get_string('sortdefault', 'block_vitrina'),
            'startdate' => get_string('sortbystartdate', 'block_vitrina'),
            'finishdate' => get_string('sortbyfinishdate', 'block_vitrina'),
            'alphabetically' => get_string('sortalphabetically', 'block_vitrina'),
            'code' => get_string('sortbycode', 'block_vitrina'),
        ];

        $sortoptions = [];
        foreach ($sortlabels as $value => $label) {
            $option = new \stdClass();
            $option->value = $value;
            $option->label = $label;
            $option->selected = $value === $sortvalue;
            $sortoptions[] = $option;
        }

        $sortdirectionlabels = [
            'asc' => get_string('sortdirection_asc', 'block_vitrina'),
            'desc' => get_string('sortdirection_desc', 'block_vitrina'),
        ];

        $sortdirectionoptions = [];
        foreach ($sortdirectionlabels as $value => $label) {
            $option = new \stdClass();
            $option->value = $value;
            $option->label = $label;
            $option->selected = $value === $sortdirectionvalue;
            $sortdirectionoptions[] = $option;
        }

        $defaultvariables = [
            'uniqueid' => $this->uniqueid,
            'baseurl' => $CFG->wwwroot,
            'hastabs' => count($showtabs) > 1,
            'tabs' => $showtabs,
            'showicon' => \block_vitrina\local\controller::show_tabicon(),
            'showtext' => \block_vitrina\local\controller::show_tabtext(),
            'filtercontrols' => $filtercontrols,
            'filterproperties' => $filterproperties,
            'tagsoptions' => $tagsoptions,
            'sortoptions' => $sortoptions,
            'sortdirectionoptions' => $sortdirectionoptions,
            'catfilterview' => $catfilterview,
            // 'opendetailstarget' => get_config('block_vitrina', 'opendetailstarget'),
            'opendetailstarget' => main::get_config_ex( $this->instanceid?: 0,'block_vitrina', 'opendetailstarget'),
        ];

        return $defaultvariables;
    }
}
