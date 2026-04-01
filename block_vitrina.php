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
 * Form for editing vitrina block instances.
 *
 * @package   block_vitrina
 * @copyright 2023 David Herney @ BambuCo
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Class containing block base implementation for Vitrina.
 *
 * @copyright 2023 David Herney @ BambuCo
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class block_vitrina extends block_base {
    /**
     * Initialice the block.
     */
    public function init() {
        $this->title = get_string('pluginname', 'block_vitrina');
    }

    /**
     * Subclasses should override this and return true if the
     * subclass block has a settings.php file.
     *
     * @return boolean
     */
    public function has_config() {
        return true;
    }

    /**
     * Which page types this block may appear on.
     *
     * The information returned here is processed by the
     * {@see blocks_name_allowed_in_format()} function. Look there if you need
     * to know exactly how this works.
     *
     * Default case: everything except mod and tag.
     *
     * @return array page-type prefix => true/false.
     */
    public function applicable_formats() {
        return ['all' => true];
    }

    /**
     * This function is called on your subclass right after an instance is loaded
     * Use this function to act on instance data just after it's loaded and before anything else is done
     * For instance: if your block will have different title's depending on location (site, course, blog, etc)
     */
    public function specialization() {
        if (isset($this->config->title)) {
            $this->title = $this->title = format_string($this->config->title, true, ['context' => $this->context]);
        } else {
            $this->title = get_string('newblocktitle', 'block_vitrina');
        }
    }

    /**
     * Are you going to allow multiple instances of each block?
     * If yes, then it is assumed that the block WILL USE per-instance configuration
     * @return boolean
     */
    public function instance_allow_multiple() {
        return true;
    }

    /**
     * Implemented to return the content object.
     *
     * @return stdObject
     */
    public function get_content() {
        global $DB, $CFG;

        require_once($CFG->libdir . '/filelib.php');

        if ($this->content !== null) {
            return $this->content;
        }

        $this->content = new stdClass();
        $this->content->text = '';
        $this->content->footer = '';

        // Security validation. If not is logged in and guest login button is disabled, do not show courses.
        if (!isloggedin() && empty($CFG->guestloginbutton) && empty($CFG->autologinguests)) {
            return $this->content;
        }

        $amount = get_config('block_vitrina', 'singleamount');

        if (!$amount || !is_numeric($amount)) {
            $amount = 4;
        }

        // Take config from instance if it isn't empty.
        if (!empty($this->config->singleamount)) {
            $amount = $this->config->singleamount;
        }

        // Load tabs and views.
        $tabnames = \block_vitrina\local\controller::get_courses_views();
        $tabs = [];

        if (isset($this->config) && is_object($this->config)) {
            foreach ($tabnames as $tabname) {
                if (property_exists($this->config, $tabname) && $this->config->$tabname) {
                    $tabs[] = $tabname;
                    $views[$tabname] = [];
                }
            }
        }

        if (empty($tabs)) {
            $tabs[] = 'default';
        }

        $html = '';
        $filteropt = new stdClass();
        $filteropt->overflowdiv = true;

        // If the content is trusted, do not clean it.
        if ($this->content_is_trusted()) {
            $filteropt->noclean = true;
        }

        if (isset($this->config->htmlheader)) {
            // Rewrite url.
            $this->config->htmlheader = file_rewrite_pluginfile_urls(
                $this->config->htmlheader,
                'pluginfile.php',
                $this->context->id,
                'block_vitrina',
                'content_header',
                null
            );
            // Default to FORMAT_HTML.
            $htmlheaderformat = FORMAT_HTML;
            // Check to see if the format has been properly set on the config.
            if (isset($this->config->htmlheaderformat)) {
                $htmlheaderformat = $this->config->htmlheaderformat;
            }
            $html .= format_text($this->config->htmlheader, $htmlheaderformat, $filteropt);
        }

        if (isset($this->config->htmlfooter)) {
            // Rewrite url.
            $this->config->htmlfooter = file_rewrite_pluginfile_urls(
                $this->config->htmlfooter,
                'pluginfile.php',
                $this->context->id,
                'block_vitrina',
                'content_footer',
                null
            );
            // Default to FORMAT_HTML.
            $htmlfooterformat = FORMAT_HTML;
            // Check to see if the format has been properly set on the config.
            if (isset($this->config->htmlfooterformat)) {
                $htmlfooterformat = $this->config->htmlfooterformat;
            }
            $this->content->footer = format_text($this->config->htmlfooter, $htmlfooterformat, $filteropt);
        }
        // Memory footprint.
        unset($filteropt);

        // Load templates to display courses.
        $renderer = $this->page->get_renderer('block_vitrina');

        // When the block instance is configured to split by categories and
        // more than one category has been selected, render one independent
        // sub-block per category. Each sub-block behaves like its own
        // block_vitrina instance: it has its own tabs, paging state and
        // load more button, and it is stacked vertically in the block
        // content area. The catalog page continues to use the unified
        // (non-split) behaviour.
        $splitbycategories = !empty($this->config->splitbycategories);
        $instancecategories = [];

        if (!empty($this->config->categories) && is_array($this->config->categories)) {
            $instancecategories = $this->config->categories;
        }

        if ($splitbycategories && count($instancecategories) > 1) {
            foreach ($instancecategories as $categoryid) {
                $categoryid = (int)$categoryid;
                if (empty($categoryid)) {
                    continue;
                }

                $uniqueid = \block_vitrina\local\controller::get_uniqueid();

                // Wrap the heading and the sub-block content in a
                // container so that the whole section can be hidden
                // on the client side if no courses are found for this
                // category when loading the first page.
                $html .= \html_writer::start_div('block_vitrina-categorysection', [
                    'data-vitrina-uniqueid' => $uniqueid,
                ]);

                // Optional category title before each sub-block.
                $category = \core_course_category::get($categoryid, IGNORE_MISSING);
                if ($category) {
                    $categoryname = $category->get_formatted_name();

                    // Build a link to the catalog page for this
                    // category, matching the "view more" URL for
                    // this sub-section (same instance id, default
                    // view and categoryid parameter).
                    $categoryurl = new \moodle_url('/blocks/vitrina/index.php', [
                        'view' => $tabs[0],
                        'id' => $this->instance->id,
                        'categoryid' => $categoryid,
                    ]);

                    $link = \html_writer::link($categoryurl, $categoryname, [
                        'class' => 'block_vitrina-categorylink',
                    ]);

                    // Slightly smaller heading with custom
                    // vertical spacing.
                    $html .= \html_writer::tag('h4', $link, [
                        'class' => 'block_vitrina-categorytitle',
                        'style' => 'margin-top:18px;margin-bottom:2px;',
                    ]);
                }

                $renderable = new \block_vitrina\output\main($uniqueid, $tabs[0], $this->instance->id, $tabs, $categoryid);
                $html .= $renderer->render($renderable);

                // Pass a fixed categories filter for this sub-block so that
                // each section shows only its own category while the
                // catalog view remains unchanged.
                $fixedfilters = [
                    [
                        'type' => 'categories',
                        'values' => [$categoryid],
                    ],
                ];

                $this->page->requires->js_call_amd(
                    'block_vitrina/main',
                    'catalog',
                    [$uniqueid, $tabs[0], $this->instance->id, $amount, $fixedfilters]
                );

                $html .= \html_writer::end_div();
            }
        } else {
            // Default behaviour: single unified block using all configured
            // categories for this instance.
            $uniqueid = \block_vitrina\local\controller::get_uniqueid();
            $renderable = new \block_vitrina\output\main($uniqueid, $tabs[0], $this->instance->id, $tabs, null);
            $html .= $renderer->render($renderable);

            $this->page->requires->js_call_amd(
                'block_vitrina/main',
                'catalog',
                [$uniqueid, $tabs[0], $this->instance->id, $amount]
            );
        }

        $this->content->text = $html;

        \block_vitrina\local\controller::include_templatecss($this->instance->id);

        return $this->content;
    }

    /**
     * Serialize and store config data.
     *
     * @param object $data
     * @param boolean $nolongerused
     * @return void
     */
    public function instance_config_save($data, $nolongerused = false) {
        global $DB;

        $config = clone($data);
        // Move embedded files into a proper filearea and adjust HTML links to match.
        $config->htmlheader = file_save_draft_area_files(
            $data->htmlheader['itemid'],
            $this->context->id,
            'block_vitrina',
            'content_header',
            0,
            ['subdirs' => true],
            $data->htmlheader['text']
        );
        $config->htmlfooter = file_save_draft_area_files(
            $data->htmlfooter['itemid'],
            $this->context->id,
            'block_vitrina',
            'content_footer',
            0,
            ['subdirs' => true],
            $data->htmlfooter['text']
        );
        $config->htmlheaderformat = $data->htmlheader['format'];
        $config->htmlfooterformat = $data->htmlfooter['format'];
        parent::instance_config_save($config, $nolongerused);
    }

    /**
     * Delete area files when the block instance is deleted.
     *
     * @return bool
     */
    public function instance_delete() {
        global $DB;
        $fs = get_file_storage();
        $fs->delete_area_files($this->context->id, 'block_vitrina');
        return true;
    }

    /**
     * Copy any block-specific data when copying to a new block instance.
     * @param int $fromid the id number of the block instance to copy from
     * @return boolean
     */
    public function instance_copy($fromid) {
        $fromcontext = context_block::instance($fromid);
        $fs = get_file_storage();

        // This extra check if file area is empty adds one query if it is not empty but saves several if it is.
        if (!$fs->is_area_empty($fromcontext->id, 'block_vitrina', 'content_header', 0, false)) {
            $draftitemid = 0;
            file_prepare_draft_area($draftitemid, $fromcontext->id, 'block_html', 'content_header', 0, ['subdirs' => true]);
            file_save_draft_area_files($draftitemid, $this->context->id, 'block_html', 'content_header', 0, ['subdirs' => true]);
        }

        // This extra check if file area is empty adds one query if it is not empty but saves several if it is.
        if (!$fs->is_area_empty($fromcontext->id, 'block_vitrina', 'content_footer', 0, false)) {
            $draftitemid = 0;
            file_prepare_draft_area($draftitemid, $fromcontext->id, 'block_html', 'content_footer', 0, ['subdirs' => true]);
            file_save_draft_area_files($draftitemid, $this->context->id, 'block_html', 'content_footer', 0, ['subdirs' => true]);
        }

        return true;
    }

    /**
     * Check if the block content is trusted and avoid JS inyection.
     *
     * @return bool
     */
    public function content_is_trusted() {
        global $SCRIPT;

        $context = context::instance_by_id($this->instance->parentcontextid, IGNORE_MISSING);
        if (!$context) {
            return false;
        }

        // Find out if this block is on the profile page.
        if ($context->contextlevel == CONTEXT_USER) {
            if ($SCRIPT === '/my/index.php') {
                return true;
            } else {
                // No JS on public personal pages, it would be a big security issue.
                return false;
            }
        }
        return true;
    }

    /**
     * Overridden by the block to prevent the block from being dockable.
     *
     * @return bool
     *
     * Return false as per MDL-64506
     */
    public function instance_can_be_docked() {
        return false;
    }
}
