// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { CoreSite, CoreSiteConfig } from '@classes/sites/site';
import { CoreCourse, CoreCourseWSSection } from '@features/course/services/course';
import { CoreDomUtils } from '@services/utils/dom';
import { CoreSites } from '@services/sites';
import { CoreSiteHome } from '@features/sitehome/services/sitehome';
import { CoreCourses, CoreCategoryData, CoreEnrolledCourseData } from '@features/courses/services/courses';
import { CoreEventObserver, CoreEvents } from '@singletons/events';
import { CoreCourseHelper, CoreCourseModuleData } from '@features/course/services/course-helper';
import { CoreCourseModuleDelegate } from '@features/course/services/module-delegate';
import { CoreCourseModulePrefetchDelegate } from '@features/course/services/module-prefetch-delegate';
import { CoreNavigationOptions, CoreNavigator } from '@services/navigator';
import { CoreBlockHelper } from '@features/block/services/block-helper';
import { CoreUtils } from '@services/utils/utils';
import { CoreTime } from '@singletons/time';
import { CoreAnalytics, CoreAnalyticsEventType } from '@services/analytics';
import { CoreBlockSideBlocksComponent } from '@features/block/components/side-blocks/side-blocks';
import { ContextLevel } from '@/core/constants';

/**
 * Page that displays site home index.
 */
@Component({
    selector: 'page-core-sitehome-index',
    templateUrl: 'index.html',
    styleUrls: ['index.scss'],
})
export class CoreSiteHomeIndexPage implements OnInit, OnDestroy {

    categories: CoreCategoryData[] = [];
    courses: CoreEnrolledCourseData[] = [];
    showOnlyEnrolled = false;

    dataLoaded = false;
    section?: CoreCourseWSSection & {
        hasContent?: boolean;
    };

    hasContent = false;
    hasBlocks = false;
    items: string[] = [];
    siteHomeId = 1;
    currentSite!: CoreSite;
    searchEnabled = false;
    newsForumModule?: CoreCourseModuleData;

    protected updateSiteObserver: CoreEventObserver;
    protected logView: () => void;

    constructor(protected route: ActivatedRoute) {
        // Refresh the enabled flags if site is updated.
        this.updateSiteObserver = CoreEvents.on(CoreEvents.SITE_UPDATED, () => {
            this.searchEnabled = !CoreCourses.isSearchCoursesDisabledInSite();
        }, CoreSites.getCurrentSiteId());

        this.logView = CoreTime.once(async () => {
            await CoreUtils.ignoreErrors(CoreCourse.logView(this.siteHomeId));

            CoreAnalytics.logEvent({
                type: CoreAnalyticsEventType.VIEW_ITEM,
                ws: 'core_course_view_course',
                name: this.currentSite.getInfo()?.sitename ?? '',
                data: { id: this.siteHomeId, category: 'course' },
                url: '/?redirect=0',
            });
        });
    }

    /**
     * @inheritdoc
     */
    ngOnInit(): void {
        this.searchEnabled = !CoreCourses.isSearchCoursesDisabledInSite();
        this.showOnlyEnrolled = CoreNavigator.getRouteBooleanParam('enrolled') || this.showOnlyEnrolled;

        this.currentSite = CoreSites.getRequiredCurrentSite();
        this.siteHomeId = CoreSites.getCurrentSiteHomeId();

        const module = CoreNavigator.getRouteParam<CoreCourseModuleData>('module');
        if (module) {
            const modNavOptions = CoreNavigator.getRouteParam<CoreNavigationOptions>('modNavOptions');
            CoreCourseHelper.openModule(module, this.siteHomeId, { modNavOptions });
        }

        this.loadContent().finally(() => {
            this.dataLoaded = true;
        });

        this.openFocusedInstance();

        this.route.queryParams.subscribe(() => this.openFocusedInstance());
    }

    /**
     * Convenience function to fetch the data.
     *
     * @returns Promise resolved when done.
     */
    protected async loadContent(): Promise<void> {
        this.hasContent = false;

        const config = this.currentSite.getStoredConfig() || { numsections: 1, frontpageloggedin: undefined };

        this.items = await CoreSiteHome.getFrontPageItems(config.frontpageloggedin);
        this.hasContent = this.items.length > 0;
    
        await Promise.all([this.fetchCategories(), this.fetchCourses()]);

        // Get the news forum.
        if (this.items.includes('NEWS_ITEMS')) {
            try {
                const forum = await CoreSiteHome.getNewsForum(this.siteHomeId);
                this.newsForumModule = await CoreCourse.getModule(forum.cmid, forum.course);
                this.newsForumModule.handlerData = await CoreCourseModuleDelegate.getModuleDataFor(
                    this.newsForumModule.modname,
                    this.newsForumModule,
                    this.siteHomeId,
                    undefined,
                    true,
                );
            } catch {
                // Ignore errors.
            }
        }

        try {
            const sections = await CoreCourse.getSections(this.siteHomeId, false, true);

            // Check "Include a topic section" setting from numsections.
            this.section = config.numsections ? sections.find((section) => section.section == 1) : undefined;
            if (this.section) {
                const result = await CoreCourseHelper.addHandlerDataForModules(
                    [this.section],
                    this.siteHomeId,
                    undefined,
                    undefined,
                    true,
                );

                this.section.hasContent = result.hasContent;
                this.hasContent = result.hasContent || this.hasContent;
            }

            this.logView();
        } catch (error) {
            CoreDomUtils.showErrorModalDefault(error, 'core.course.couldnotloadsectioncontent', true);
        }

        this.hasBlocks = await CoreBlockHelper.hasCourseBlocks(this.siteHomeId);
    }

    protected async fetchCategories(): Promise<void> {
        try {
            const categories = await CoreCourses.getCategories(0, true);
            console.log('Fetched categories: ', categories);
            this.categories = categories;
        } catch (error) {
            console.error('Failed to fetch categories', error);
            this.categories = [];
        }
    }

    protected async fetchCourses(): Promise<void> {
        try {
            const courses = await CoreCourses.getUserCourses();
            console.log('Fetched courses: ', courses);
            this.courses = courses;
        } catch (error) {
            //console.error('Failed to fetch courses', error);
            this.courses = [];
        }
    }

    /**
     * Open a category.
     *
     * @param categoryId Category Id.
     */
    openCategory(categoryId: number): void {
        CoreNavigator.navigateToSitePath(
            'courses/categories/' + categoryId,
            { params: {
                enrolled: this.showOnlyEnrolled,
            } },
        );
    }

        /**
     * Open a course.
     */
    openCourse(course): void {
        CoreCourseHelper.openCourse(course, { params: { isGuest: false } });
    }

    /**
     * Refresh the data.
     *
     * @param refresher Refresher.
     */
    doRefresh(refresher?: HTMLIonRefresherElement): void {
        const promises: Promise<unknown>[] = [];

        promises.push(CoreCourse.invalidateSections(this.siteHomeId));
        promises.push(this.currentSite.invalidateConfig().then(async () => {
            // Config invalidated, fetch it again.
            const config: CoreSiteConfig = await this.currentSite.getConfig();
            this.currentSite.setConfig(config);

            return;
        }));

        promises.push(CoreCourse.invalidateCourseBlocks(this.siteHomeId));

        if (this.section && this.section.modules) {
            // Invalidate modules prefetch data.
            promises.push(CoreCourseModulePrefetchDelegate.invalidateModules(this.section.modules, this.siteHomeId));
        }

        Promise.all(promises).finally(async () => {
            await this.loadContent().finally(() => {
                refresher?.complete();
            });
        });
    }

    /**
     * Go to search courses.
     */
    openSearch(): void {
        CoreNavigator.navigateToSitePath('courses/list', { params : { mode: 'search' } });
    }

    /**
     * Go to available courses.
     */
    openAvailableCourses(): void {
        CoreNavigator.navigateToSitePath('courses/list', { params : { mode: 'all' } });
    }

    /**
     * Go to my courses.
     */
    openMyCourses(): void {
        CoreNavigator.navigateToSitePath('courses/list', { params : { mode: 'my' } });
    }

    /**
     * Go to course categories.
     */
    openCourseCategories(): void {
        CoreNavigator.navigateToSitePath('courses/categories');
    }

    /**
     * @inheritdoc
     */
    ngOnDestroy(): void {
        this.updateSiteObserver.off();
    }

    /**
     * Check whether there is a focused instance in the page parameters and open it.
     */
    private openFocusedInstance() {
        const blockInstanceId = CoreNavigator.getRouteNumberParam('blockInstanceId');

        if (blockInstanceId) {
            CoreDomUtils.openSideModal({
                component: CoreBlockSideBlocksComponent,
                componentProps: {
                    contextLevel: ContextLevel.COURSE,
                    instanceId: this.siteHomeId,
                    initialBlockInstanceId: blockInstanceId,
                },
            });
        }
    }

}
